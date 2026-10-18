import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { defaultAlertConfig, updateAlertConfig, evaluateTokenAlert, evaluateVolumeSpike } from "../../packages/analysis/src/alert-config.js";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { parseTokenInfo } from "../../packages/gmgn/src/client.js";
import { live, info, security, mint, otherMint, evm } from "./live-fixtures.js";

async function setup() {
  const file = join(await mkdtemp(join(tmpdir(), "alert-config-")), "state.json");
  const adapter = { discoverTokens: vi.fn(async () => [] as string[]), getTokenSnapshot: async () => live() };
  const monitor = new RunnerMonitor(adapter, file, true, ["sol", "robinhood"]);
  await monitor.init();
  return { monitor, file, adapter };
}

describe("runtime runner alert settings", () => {
  it("validates values, aliases, unknown keys, and pollution keys", () => {
    const c = defaultAlertConfig();
    expect(updateAlertConfig(c, "tokenAlertsEnabled", "false").config.tokenAlerts.enabled).toBe(false);
    expect(c.tokenAlerts.enabled).toBe(true);
    for (const [key, value] of [["tokenAlerts.pollIntervalSec", "14"], ["robinhoodAlerts.pollIntervalSec", "301"],
      ["tokenAlerts.enabled", "yes"], ["tokenAlerts.maxPerScan", "0"], ["tokenAlerts.minTotalFeesSol", "NaN"],
      ["tokenAlerts.minVolume5mUsd", "Infinity"], ["tokenAlerts.volumeSpikeMultiplier", "1"], ["__proto__", "1"]]) {
      expect(() => updateAlertConfig(c, key, value)).toThrow();
    }
    expect(updateAlertConfig(c, "tokenAlerts.pollIntervalSec", "15").value).toBe(15);
    expect(updateAlertConfig(c, "robinhoodAlerts.pollIntervalSec", "300").value).toBe(300);
  });

  it("uses strict market cap, inclusive volume/fees and DEX age, rejecting missing data", () => {
    const c = defaultAlertConfig();
    const s = { ...live(), volume5mUsd: 100000, totalFeesNative: 10, dexAgeMinutes: 30 };
    expect(evaluateTokenAlert(s, c).passed).toBe(true);
    for (const overrides of [{ marketCapUsd: 100000 }, { dexAgeMinutes: null }, { dexAgeMinutes: 31 },
      { volume5mUsd: null }, { volume5mUsd: 99999 }, { totalFeesNative: null }, { totalFeesNative: 9 },
      { runnerBlockReason: "Provider risk" }]) expect(evaluateTokenAlert({ ...s, ...overrides }, c).passed).toBe(false);
    expect(evaluateTokenAlert({ ...s, chain: "robinhood", mint: evm, marketCapUsd: null, dexAgeMinutes: null, totalFeesNative: 0.1 }, c).passed).toBe(true);
  });

  it("parses rolling metrics, native fees and migration without creation-time fallback", () => {
    const now = Date.now();
    const s = parseTokenInfo({ ...info, open_timestamp: Math.floor(now / 1000) - 1200,
      migrated_timestamp: Math.floor(now / 1000) - 60 }, mint, security);
    expect(s.dexAgeMinutes).toBeGreaterThanOrEqual(1);
    expect(s.dexAgeMinutes).toBeLessThan(1.1);
    expect(s.volume5mUsd).toBe(200000);
    expect(s.swaps5m).toBe(80);
    expect(s.totalFeesNative).toBe(12);
    expect(s.feesNativeSymbol).toBe("SOL");
    const missing = parseTokenInfo({ ...info, open_timestamp: 0, migrated_timestamp: 0, total_fee: undefined }, mint, security);
    expect(missing.dexAgeMinutes).toBeNull();
    expect(missing.totalFeesNative).toBeNull();
  });

  it("persists settings across restart and preserves previous config after invalid input", async () => {
    const { monitor, file, adapter } = await setup();
    await monitor.setConfig("tokenAlerts.pollIntervalSec", "15");
    await expect(monitor.setConfig("tokenAlerts.pollIntervalSec", "1")).rejects.toThrow();
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    expect(restored.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(15);
    expect(restored.snapshot().version).toBe(3);
  });

  it("polls networks independently and honors live disables", async () => {
    const { monitor, adapter } = await setup();
    await monitor.setConfig("tokenAlerts.pollIntervalSec", "15");
    const now = Date.now();
    expect(await monitor.cycle({ scheduled: true, now })).toEqual(["sol", "robinhood"]);
    expect(await monitor.cycle({ scheduled: true, now: now + 14000 })).toEqual([]);
    expect(await monitor.cycle({ scheduled: true, now: now + 15000 })).toEqual(["sol"]);
    await monitor.setConfig("tokenAlerts.enabled", "false");
    expect(await monitor.cycle({ scheduled: true, now: now + 60000 })).toEqual(["robinhood"]);
    expect(adapter.discoverTokens).toHaveBeenCalledTimes(4);
    await monitor.observe(live());
    expect(monitor.snapshot().records).toHaveLength(0);
  });

  it("enforces per-network sending budgets without discarding backlog", async () => {
    const { monitor } = await setup();
    await monitor.setConfig("tokenAlerts.maxPerScan", "1");
    await monitor.observe(live());
    await monitor.observe({ ...live(), mint: otherMint });
    await monitor.observe({ ...live(), chain: "robinhood", mint: evm });
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send, ["sol"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(2);
    await monitor.setConfig("tokenAlerts.enabled", "false");
    await monitor.deliverNotifications(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
  });

  it("requires real baseline and all spike gates, but does not apply the new-token age gate", () => {
    const c = defaultAlertConfig();
    const s = { ...live(), dexAgeMinutes: 1000, volume5mUsd: 300000 };
    expect(evaluateVolumeSpike(s, c, 100000).passed).toBe(true);
    for (const baseline of [null, 0, 100001]) expect(evaluateVolumeSpike(s, c, baseline).passed).toBe(false);
    for (const overrides of [{ swaps5m: 49 }, { liquidityUsd: 9999 }, { totalFeesNative: 9 }, { volume5mUsd: null }]) {
      expect(evaluateVolumeSpike({ ...s, ...overrides }, c, 100000).passed).toBe(false);
    }
  });

  it("warms up non-overlapping windows, persists cooldown and expires stale baselines", async () => {
    const { monitor, file, adapter } = await setup();
    const t = Date.now();
    const observe = (target: RunnerMonitor, minute: number, volume: number) => target.observe({ ...live(),
      dexAgeMinutes: 1000, volume5mUsd: volume, observedAt: new Date(t + minute * 60000).toISOString() });
    for (const minute of [0, 1, 5, 10]) await observe(monitor, minute, 40000);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
    await observe(monitor, 15, 200000);
    expect(monitor.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["spike"]);
    const alert = monitor.snapshot().pendingAlerts[0];
    expect(alert.record.spikeMultiplier).toBe(5);
    expect(formatRunnerNotification(alert)).toContain("VOLUME SPIKE TERDETEKSI");
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    await observe(restored, 16, 300000);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    await observe(restored, 400, 1000000);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    for (const minute of [405, 410]) await observe(restored, minute, 40000);
    await observe(restored, 415, 3000000);
    expect(restored.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["spike", "spike"]);
  });
});
