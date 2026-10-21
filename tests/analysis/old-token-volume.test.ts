import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Chain, MarketSnapshot } from "@sti/shared";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { defaultAlertConfig, evaluateOldTokenVolume, updateAlertConfig } from "../../packages/analysis/src/alert-config.js";
import { live, evm } from "./live-fixtures.js";

const sections = { sol: "tokenAlerts", bsc: "bscAlerts", robinhood: "robinhoodAlerts" } as const;
function old(chain: Chain = "sol", volume = 150000): MarketSnapshot {
  return { ...live(), chain, mint: chain === "sol" ? live().mint : evm,
    dexAgeMinutes: 180 * 1440, volume5mUsd: volume, totalFeesNative: null,
    marketCapUsd: null, swaps5m: null, feesNativeSymbol: undefined };
}
async function setup(chain: Chain = "sol") {
  const file = join(await mkdtemp(join(tmpdir(), "old-volume-")), "state.json");
  const adapter = { discoverTokens: vi.fn(async () => [] as string[]), getTokenSnapshot: vi.fn(async () => old(chain)) };
  const monitor = new RunnerMonitor(adapter, file, true, [chain]);
  await monitor.init();
  return { file, adapter, monitor };
}

describe("age-independent rolling volume alerts", () => {
  it.each(["sol", "bsc", "robinhood"] as const)("alerts a months-old %s token without fees, swaps, cap or baseline", async (chain) => {
    const { monitor } = await setup(chain);
    await monitor.observe(old(chain));
    const [event] = monitor.snapshot().pendingAlerts;
    expect(event.kind).toBe("volume");
    expect(event.record.volumeTrigger).toBe("high");
    expect(event.record.baselineVolume5mUsd).toBeNull();
    const text = formatRunnerNotification(event);
    expect(text).toContain(`${chain === "sol" ? "SOLANA" : chain === "bsc" ? "BSC" : "ROBINHOOD"} VOLUME ALERT`);
    expect(text).toContain("VOLUME TINGGI TERDETEKSI");
    expect(text).toContain("Volume ≥ $150K/5m");
    expect(text).toContain("Umur 180 hari");
    expect(text).not.toMatch(/QUALIFIED|<pre>|<code>|N\/Ax/);
  });

  it("validates independent nested settings, aliases and migration defaults", async () => {
    const config = defaultAlertConfig();
    for (const chain of ["sol", "bsc", "robinhood"] as const) {
      const section = sections[chain];
      expect(config[section].oldTokenVolume).toEqual({ enabled: true, minVolume5mUsd: 150000,
        minLiquidityUsd: 10000, spikeMultiplier: 3, cooldownMin: 60,
        [chain === "sol" ? "minTotalFeesSol" : chain === "bsc" ? "minTotalFeesBnb" : "minTotalFeesEth"]: 0 });
      for (const [key, value] of [["enabled", "yes"], ["minVolume5mUsd", "NaN"], ["minLiquidityUsd", "-1"],
        ["spikeMultiplier", "1"], ["cooldownMin", "0"], ["__proto__", "1"]]) {
        expect(() => updateAlertConfig(config, `${section}.oldTokenVolume.${key}`, value)).toThrow();
      }
    }
    const updated = updateAlertConfig(config, "bscAlertsOldTokenVolumeMinVolume5mUsd", "200000").config;
    expect(updated.bscAlerts.oldTokenVolume.minVolume5mUsd).toBe(200000);
    expect(updated.tokenAlerts).toEqual(config.tokenAlerts);
    const { file, monitor, adapter } = await setup();
    await monitor.observe(old());
    const legacy = JSON.parse(await readFile(file, "utf8"));
    for (const section of Object.values(sections)) delete legacy.alertConfig[section].oldTokenVolume;
    for (const baseline of legacy.volumeBaselines) {
      delete baseline.latestVolume5mUsd; delete baseline.lastVolumeAlertAt;
    }
    for (const record of [...legacy.records, ...legacy.pendingAlerts.map((event: { record: unknown }) => event.record)]) {
      delete record.volumeTrigger; delete record.volumeThresholdUsd;
    }
    await writeFile(file, JSON.stringify(legacy));
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    expect(restored.snapshot().alertConfig.tokenAlerts.oldTokenVolume.enabled).toBe(true);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    expect(restored.snapshot().volumeBaselines[0].lastVolumeAlertAt).toBeNull();
    await restored.setConfig("tokenAlerts.oldTokenVolume.cooldownMin", "120");
    const restarted = new RunnerMonitor(adapter, file, true);
    await restarted.init();
    expect(restarted.snapshot().alertConfig.tokenAlerts.oldTokenVolume.cooldownMin).toBe(120);
  });

  it("requires real rolling volume, liquidity, live price and unblocked risk data, not age or 24h volume", () => {
    const config = defaultAlertConfig();
    expect(evaluateOldTokenVolume({ ...old(), dexAgeMinutes: null }, config)).toBe(true);
    for (const overrides of [{ volume5mUsd: null, volume24hUsd: 99999999 }, { volume5mUsd: 149999 },
      { liquidityUsd: null }, { liquidityUsd: 9999 }, { priceUsd: null }, { priceUsd: 0 },
      { source: "fixture" as const }, { runnerBlockReason: "Honeypot / authority blocked" }]) {
      expect(evaluateOldTokenVolume({ ...old(), ...overrides }, config)).toBe(false);
    }
    expect(evaluateOldTokenVolume(old(), updateAlertConfig(config, "tokenAlerts.enabled", "false").config)).toBe(false);
    expect(evaluateOldTokenVolume(old(), updateAlertConfig(config, "tokenAlerts.oldTokenVolume.enabled", "false").config)).toBe(false);
  });

  it.each(["sol", "bsc", "robinhood"] as const)("distinguishes a %s crossing and persists dedup/cooldown through restart", async (chain) => {
    const { monitor, adapter, file } = await setup(chain);
    const t = Date.now();
    const observe = (target: RunnerMonitor, minute: number, volume: number) => target.observe({ ...old(chain, volume),
      observedAt: new Date(t + minute * 60000).toISOString() });
    await observe(monitor, 0, 100000);
    await observe(monitor, 1, 150000);
    expect(monitor.snapshot().pendingAlerts[0].record.volumeTrigger).toBe("crossing");
    expect(formatRunnerNotification(monitor.snapshot().pendingAlerts[0])).toContain("VOLUME TEMBUS BATAS");
    await monitor.deliverNotifications(async () => { throw new Error("offline"); });
    const restored = new RunnerMonitor(adapter, file, true, [chain]);
    await restored.init();
    await observe(restored, 2, 200000);
    await observe(restored, 60, 200000);
    await observe(restored, 61, 200000);
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    await observe(restored, 62, 50000);
    await observe(restored, 63, 160000);
    expect(restored.snapshot().pendingAlerts).toHaveLength(2);
    expect(restored.snapshot().pendingAlerts[0].id).not.toBe(restored.snapshot().pendingAlerts[1].id);
    await restored.observe(old(chain)); // Earlier sample cannot replay an event.
    expect(restored.snapshot().pendingAlerts).toHaveLength(2);
    const send = vi.fn(async () => undefined);
    await restored.deliverNotifications(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(restored.snapshot().pendingAlerts).toHaveLength(0);
  });

  it.each(["sol", "bsc", "robinhood"] as const)("calculates %s spikes from three separate five-minute windows only", async (chain) => {
    const { monitor } = await setup(chain);
    const t = Date.now();
    for (const minute of [0, 1, 5, 10]) await monitor.observe({ ...old(chain, 40000),
      observedAt: new Date(t + minute * 60000).toISOString() });
    await monitor.observe({ ...old(chain, 200000), observedAt: new Date(t + 15 * 60000).toISOString() });
    const event = monitor.snapshot().pendingAlerts[0];
    expect(event.kind).toBe("volume");
    expect(event.record.volumeTrigger).toBe("spike");
    expect(event.record.baselineVolume5mUsd).toBe(40000);
    expect(event.record.spikeMultiplier).toBe(5);
    expect(formatRunnerNotification(event)).toContain("VOLUME SPIKE");
    expect(formatRunnerNotification(event)).toContain("<b>5x</b>");
  });

  it("does not duplicate a new candidate, or let legacy spikes bypass the volume cooldown", async () => {
    const { monitor } = await setup();
    const t = Date.now();
    await monitor.observe({ ...live(), observedAt: new Date(t).toISOString() });
    expect(monitor.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["candidate"]);
    for (const minute of [5, 10, 15]) await monitor.observe({ ...old("sol", 10000),
      observedAt: new Date(t + minute * 60000).toISOString() });
    await monitor.observe({ ...live(), dexAgeMinutes: 10000, volume5mUsd: 300000,
      observedAt: new Date(t + 20 * 60000).toISOString() });
    expect(monitor.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["candidate"]);
  });

  it("keeps old RH alerts on the volume path even when native fees pass the candidate gate", async () => {
    const { monitor } = await setup("robinhood");
    await monitor.observe({ ...old("robinhood"), totalFeesNative: 1, feesNativeSymbol: "ETH" });
    expect(monitor.snapshot().pendingAlerts[0].kind).toBe("volume");
  });

  it("does not start a volume cooldown for a candidate below the volume threshold", async () => {
    const { monitor } = await setup();
    const t = Date.now();
    await monitor.observe({ ...live(), volume5mUsd: 100000, observedAt: new Date(t).toISOString() });
    await monitor.observe({ ...live(), volume5mUsd: 150000, observedAt: new Date(t + 60000).toISOString() });
    expect(monitor.snapshot().pendingAlerts.map((e) => e.kind)).toEqual(["candidate", "volume"]);
    expect(monitor.snapshot().pendingAlerts[1].record.volumeTrigger).toBe("crossing");
  });

  it("continues refreshing saved tokens after seven days when discovery omits them", async () => {
    const { monitor, adapter } = await setup();
    await monitor.observe({ ...old(), observedAt: new Date(Date.now() - 30 * 86400000).toISOString() });
    await monitor.cycle();
    expect(adapter.getTokenSnapshot).toHaveBeenCalledWith(live().mint, "sol");
    expect(monitor.snapshot().records[0].observations).toBe(2);
  });

  it.each(["sol", "bsc", "robinhood"] as const)("discovers months-old %s tokens without a migration-age gate", async (chain) => {
    const { monitor, adapter } = await setup(chain);
    adapter.discoverTokens.mockResolvedValue([old(chain).mint]);
    await monitor.cycle();
    expect(monitor.snapshot().pendingAlerts[0].kind).toBe("volume");
    expect(adapter.discoverTokens).toHaveBeenCalledWith(chain);
  });

  it("never calls overlapping samples or expired samples a prepared baseline", async () => {
    const { monitor } = await setup();
    const t = Date.now();
    for (const minute of [0, 1, 2]) await monitor.observe({ ...old("sol", 10000),
      observedAt: new Date(t + minute * 60000).toISOString() });
    await monitor.observe({ ...old(), observedAt: new Date(t + 3 * 60000).toISOString() });
    expect(monitor.snapshot().pendingAlerts[0].record.baselineVolume5mUsd).toBeNull();
    for (const minute of [5, 10]) await monitor.observe({ ...old("sol", 10000),
      observedAt: new Date(t + minute * 60000).toISOString() });
    await monitor.observe({ ...old(), observedAt: new Date(t + 90 * 60000).toISOString() });
    const last = monitor.snapshot().pendingAlerts.at(-1)!;
    expect(last.record.baselineVolume5mUsd).toBeNull();
    expect(last.record.volumeTrigger).toBe("crossing");
  });

  it("keeps cooldowns isolated for the same EVM address across BSC and RH", async () => {
    const { file, adapter } = await setup();
    const monitor = new RunnerMonitor(adapter, file, true, ["bsc", "robinhood"]);
    await monitor.init();
    const t = Date.now();
    for (const chain of ["bsc", "robinhood"] as const) {
      await monitor.observe({ ...old(chain), observedAt: new Date(t).toISOString() });
      await monitor.observe({ ...old(chain), observedAt: new Date(t + 1000).toISOString() });
    }
    expect(monitor.snapshot().pendingAlerts.map((e) => e.record.chain)).toEqual(["bsc", "robinhood"]);
    await monitor.setConfig("bscAlerts.oldTokenVolume.enabled", "false");
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send);
    expect(send).toHaveBeenCalledOnce();
    expect(monitor.snapshot().pendingAlerts[0].record.chain).toBe("bsc");
  });

  it("holds pending volume alerts while disabled without blocking other event kinds", async () => {
    const { monitor } = await setup();
    await monitor.observe(old());
    await monitor.setConfig("tokenAlerts.oldTokenVolume.enabled", "false");
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send);
    expect(send).not.toHaveBeenCalled();
    await monitor.setConfig("tokenAlerts.oldTokenVolume.enabled", "true");
    await monitor.deliverNotifications(send);
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not silence volume events when the 50-record tracking list is full", async () => {
    const { monitor } = await setup("bsc");
    for (let n = 1; n <= 51; n++) await monitor.observe({ ...old("bsc"), mint: `0x${n.toString(16).padStart(40, "0")}` });
    expect(monitor.snapshot().records).toHaveLength(50);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(51);
    expect(monitor.snapshot().volumeBaselines).toHaveLength(51);
  });
});
