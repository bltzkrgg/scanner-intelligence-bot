import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { defaultAlertConfig, updateAlertConfig, evaluateTokenAlert, evaluateVolumeSpike } from "../../packages/analysis/src/alert-config.js";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { parseTokenInfo } from "../../packages/gmgn/src/client.js";
import { info, security, live, evm } from "./live-fixtures.js";

const secondEvm = "0x0000000000000000000000000000000000000001";
function bsc(safety: unknown = { ...security, is_honeypot: false }) {
  return parseTokenInfo({ ...info, address: evm, total_fee: "0.5", price: { ...info.price, volume_5m: "50000" } },
    evm, safety, Date.now(), "bsc");
}
async function setup() {
  const file = join(await mkdtemp(join(tmpdir(), "bsc-alert-")), "state.json");
  const adapter = { discoverTokens: vi.fn(async () => [] as string[]), getTokenSnapshot: async () => bsc() };
  const monitor = new RunnerMonitor(adapter, file, true, ["sol", "bsc", "robinhood"]);
  await monitor.init();
  return { monitor, file, adapter };
}

describe("BSC configurable runner", () => {
  it("has independent BNB defaults and validates BSC settings and aliases", () => {
    const config = defaultAlertConfig();
    expect(config.bscAlerts).toEqual({ enabled: true, pollIntervalSec: 60, minVolume5mUsd: 50000,
      minMarketCapUsd: 100000, minTotalFeesBnb: 0.5, maxAgeMin: 60, maxPerScan: 5,
      volumeSpikeMultiplier: 3, volumeSpikeMinSwaps5m: 50,
      volumeSpikeMinLiquidityUsd: 20000, volumeSpikeCooldownMin: 360 });
    const updated = updateAlertConfig(config, "bscAlertsMinTotalFeesBnb", "0.25").config;
    expect(updated.bscAlerts.minTotalFeesBnb).toBe(0.25);
    expect(updated.tokenAlerts).toEqual(config.tokenAlerts);
    expect(updated.robinhoodAlerts).toEqual(config.robinhoodAlerts);
    for (const [key, value] of [["pollIntervalSec", "14"], ["pollIntervalSec", "301"], ["enabled", "yes"],
      ["minTotalFeesBnb", "-1"], ["maxPerScan", "51"], ["volumeSpikeMultiplier", "1"],
      ["minVolume5mUsd", "Infinity"], ["volumeSpikeCooldownMin", "0"]]) {
      expect(() => updateAlertConfig(config, `bscAlerts.${key}`, value)).toThrow();
    }
    expect(() => updateAlertConfig(config, "bscAlerts.minTotalFeesSol", "1")).toThrow();
  });

  it("uses BNB fees, volume, strict market cap, and inclusive DEX age", () => {
    const config = defaultAlertConfig();
    const snapshot = { ...bsc(), dexAgeMinutes: 60 };
    expect(snapshot.feesNativeSymbol).toBe("BNB");
    expect(evaluateTokenAlert(snapshot, config).passed).toBe(true);
    for (const overrides of [{ totalFeesNative: 0.499 }, { totalFeesNative: null }, { volume5mUsd: 49999 },
      { volume5mUsd: null }, { marketCapUsd: 100000 }, { dexAgeMinutes: 60.01 }, { dexAgeMinutes: null }]) {
      expect(evaluateTokenAlert({ ...snapshot, ...overrides }, config).passed).toBe(false);
    }
    const raised = updateAlertConfig(config, "bscAlerts.minTotalFeesBnb", "1").config;
    expect(evaluateTokenAlert(snapshot, raised).passed).toBe(false);
  });

  it("blocks missing/positive honeypot and wash trading even with permissive thresholds", () => {
    const config = defaultAlertConfig();
    for (const safety of [security, { ...security, is_honeypot: true },
      { ...security, is_honeypot: false, is_wash_trading: true }]) {
      const snapshot = bsc(safety);
      expect(snapshot.runnerBlockReason).toBeTruthy();
      expect(evaluateTokenAlert(snapshot, config).passed).toBe(false);
      expect(evaluateVolumeSpike(snapshot, config, 10000).passed).toBe(false);
    }
    const missing = parseTokenInfo({ ...info, address: evm }, evm, undefined, Date.now(), "bsc");
    expect(evaluateTokenAlert(missing, config).passed).toBe(false);
  });

  it("migrates existing v3 state with BSC defaults without replaying detection", async () => {
    const { monitor, file, adapter } = await setup();
    await monitor.setConfig("tokenAlerts.pollIntervalSec", "90");
    await monitor.observe(bsc());
    const old = JSON.parse(await readFile(file, "utf8"));
    delete old.alertConfig.bscAlerts;
    await writeFile(file, JSON.stringify(old));
    const restored = new RunnerMonitor(adapter, file, true, ["bsc"]);
    await restored.init();
    expect(restored.snapshot().alertConfig.bscAlerts.minTotalFeesBnb).toBe(0.5);
    expect(restored.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(90);
    expect(restored.snapshot().records).toHaveLength(1);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    await restored.setConfig("bscAlerts.minTotalFeesBnb", "0.25");
    const restarted = new RunnerMonitor(adapter, file, true, ["bsc"]);
    await restarted.init();
    expect(restarted.snapshot().alertConfig.bscAlerts.minTotalFeesBnb).toBe(0.25);
    expect(restarted.snapshot().records[0].initialPrice).toBe(1);
  });

  it("uses configured BSC filters rather than the old Runner Score gate", async () => {
    const { monitor } = await setup();
    await monitor.observe({ ...bsc(), volume5mUsd: 49999 });
    expect(monitor.snapshot().records).toHaveLength(0);
    await monitor.observe({ ...bsc(), priceChange1hPct: -20, buys1h: 1, sells1h: 100 });
    expect(monitor.snapshot().records).toHaveLength(1);
    expect(monitor.snapshot().records[0].score).toBeLessThan(70);
    expect(monitor.snapshot().records[0].qualification).toBe("configured");
    expect(formatRunnerNotification(monitor.snapshot().pendingAlerts[0])).toContain("filter alert admin");
  });

  it("polls BSC on its own schedule and stops polling when disabled", async () => {
    const { monitor } = await setup();
    await monitor.setConfig("bscAlerts.pollIntervalSec", "15");
    const now = Date.now();
    expect(await monitor.cycle({ scheduled: true, now })).toEqual(["sol", "bsc", "robinhood"]);
    expect(await monitor.cycle({ scheduled: true, now: now + 14000 })).toEqual([]);
    expect(await monitor.cycle({ scheduled: true, now: now + 15000 })).toEqual(["bsc"]);
    await monitor.setConfig("bscAlerts.enabled", "false");
    expect(await monitor.cycle({ scheduled: true, now: now + 60000 })).toEqual(["sol", "robinhood"]);
    await monitor.observe(bsc());
    expect(monitor.snapshot().records).toHaveLength(0);
  });

  it("limits BSC delivery, retains failed backlog, and isolates the same CA on RH", async () => {
    const { monitor } = await setup();
    await monitor.setConfig("bscAlerts.maxPerScan", "1");
    await monitor.observe(bsc());
    await monitor.observe({ ...bsc(), mint: secondEvm });
    await monitor.observe({ ...live(), chain: "robinhood", mint: evm, feesNativeSymbol: "ETH" });
    await monitor.deliverNotifications(async () => { throw new Error("offline"); }, ["bsc"]);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(3);
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send, ["bsc"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(2);
    await monitor.setConfig("bscAlerts.enabled", "false");
    await monitor.deliverNotifications(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot().pendingAlerts[0].record.chain).toBe("bsc");
    expect(monitor.snapshot().records.filter((r) => r.mint === evm)).toHaveLength(2);
  });

  it("detects BSC spikes with its own baseline and persists per-chain cooldown", async () => {
    const { monitor, file, adapter } = await setup();
    const t = Date.now();
    const observe = (target: RunnerMonitor, minute: number, volume: number) => target.observe({ ...bsc(),
      dexAgeMinutes: 1000, volume5mUsd: volume, observedAt: new Date(t + minute * 60000).toISOString() });
    for (const minute of [0, 1, 5, 10]) await observe(monitor, minute, 20000);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
    await observe(monitor, 15, 60000);
    const alert = monitor.snapshot().pendingAlerts[0];
    expect(alert.kind).toBe("spike");
    expect(alert.record.baselineVolume5mUsd).toBe(20000);
    expect(alert.record.spikeMultiplier).toBe(3);
    const text = formatRunnerNotification(alert);
    expect(text).toContain("BSC | LIVE");
    expect(text).toContain("0.5 BNB");
    expect(text).not.toContain(" SOL");
    const restored = new RunnerMonitor(adapter, file, true, ["bsc", "robinhood"]);
    await restored.init();
    await observe(restored, 16, 80000);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    for (const minute of [400, 405, 410]) await observe(restored, minute, 20000);
    await observe(restored, 415, 60000);
    expect(restored.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["spike", "spike"]);
    expect(restored.snapshot().volumeBaselines[0].chain).toBe("bsc");
  });

  it("applies BSC spike liquidity/swaps gates independently of Solana and RH", () => {
    const config = defaultAlertConfig();
    const s = { ...bsc(), volume5mUsd: 60000, liquidityUsd: 20000, swaps5m: 50, dexAgeMinutes: 1000 };
    expect(evaluateVolumeSpike(s, config, 20000).passed).toBe(true);
    expect(evaluateVolumeSpike({ ...s, chain: "sol" }, config, 20000).passed).toBe(false);
    expect(evaluateVolumeSpike({ ...s, chain: "robinhood" }, config, 20000).passed).toBe(false);
    for (const overrides of [{ liquidityUsd: 19999 }, { swaps5m: 49 }, { liquidityUsd: null }, { swaps5m: null }]) {
      expect(evaluateVolumeSpike({ ...s, ...overrides }, config, 20000).passed).toBe(false);
    }
  });
});
