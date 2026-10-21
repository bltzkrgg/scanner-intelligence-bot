import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alertConfigSchema, defaultAlertConfig, evaluateOldTokenVolume, evaluateTokenAlert, evaluateVolumeSpike, updateAlertConfig,
  RunnerMonitor, formatRunnerNotification } from "@sti/analysis";
import { type Chain } from "@sti/shared";
import { live, evm } from "./live-fixtures.js";

const chains = ["sol", "bsc", "robinhood"] as const;
const section = (chain: Chain) => chain === "sol" ? "tokenAlerts" : chain === "bsc" ? "bscAlerts" : "robinhoodAlerts";
const fee = (chain: Chain) => chain === "sol" ? "minTotalFeesSol" : chain === "bsc" ? "minTotalFeesBnb" : "minTotalFeesEth";
function snapshot(chain: Chain) {
  return { ...live(), chain, mint: chain === "sol" ? live().mint : evm,
    feesNativeSymbol: chain === "sol" ? "SOL" as const : chain === "bsc" ? "BNB" as const : "ETH" as const };
}

describe("native fees per network and alert type", () => {
  it.each(chains)("validates %s old-token fees and preserves other chains", (chain) => {
    const original = defaultAlertConfig();
    const path = `${section(chain)}.oldTokenVolume.${fee(chain)}`;
    const c = updateAlertConfig(original, path, "2.5").config;
    const s = { ...snapshot(chain), dexAgeMinutes: 100000 };
    expect(evaluateOldTokenVolume({ ...s, totalFeesNative: 2.5 }, c)).toBe(true);
    for (const overrides of [{ totalFeesNative: 2.49 }, { totalFeesNative: null }, { feesNativeSymbol: undefined },
      { feesNativeSymbol: chain === "sol" ? "ETH" as const : "SOL" as const }]) {
      expect(evaluateOldTokenVolume({ ...s, ...overrides }, c)).toBe(false);
    }
    for (const bad of ["-1", "NaN", "Infinity", ""]) expect(() => updateAlertConfig(c, path, bad)).toThrow();
    const disabled = updateAlertConfig(c, path, "0").config;
    expect(evaluateOldTokenVolume({ ...s, totalFeesNative: null, feesNativeSymbol: undefined }, disabled)).toBe(true);
    for (const other of chains.filter((value) => value !== chain)) expect(c[section(other)]).toEqual(original[section(other)]);
    expect(c[section(chain)].oldTokenVolume.minVolume5mUsd).toBe(150000);
  });

  it.each(chains)("disables the %s new-token fee filter with zero but never bypasses security", (chain) => {
    const c = updateAlertConfig(defaultAlertConfig(), `${section(chain)}.${fee(chain)}`, "0").config;
    const s = { ...snapshot(chain), totalFeesNative: null, feesNativeSymbol: undefined };
    expect(evaluateTokenAlert(s, c).passed).toBe(true);
    expect(evaluateTokenAlert({ ...s, runnerBlockReason: "Provider blocked" }, c).passed).toBe(false);
    expect(evaluateTokenAlert({ ...s, volume5mUsd: null }, c).passed).toBe(false);
  });

  it.each(["sol", "bsc"] as const)("separates %s legacy spike fees from candidate and old-volume fees", (chain) => {
    const prefix = section(chain);
    let c = defaultAlertConfig();
    c = updateAlertConfig(c, `${prefix}.${fee(chain)}`, "50").config;
    c = updateAlertConfig(c, `${prefix}.oldTokenVolume.${fee(chain)}`, "100").config;
    c = updateAlertConfig(c, `${prefix}.volumeSpikeMinTotalFees${chain === "sol" ? "Sol" : "Bnb"}`, "2").config;
    const s = { ...snapshot(chain), volume5mUsd: 300000, totalFeesNative: 2 };
    expect(evaluateTokenAlert(s, c).passed).toBe(false);
    expect(evaluateOldTokenVolume(s, c)).toBe(false);
    expect(evaluateVolumeSpike(s, c, 50000).passed).toBe(true);
    expect(evaluateVolumeSpike({ ...s, totalFeesNative: 1.99 }, c, 50000).passed).toBe(false);
    expect(evaluateVolumeSpike({ ...s, feesNativeSymbol: undefined }, c, 50000).passed).toBe(false);
  });

  it("migrates legacy spike fees from each chain's configured candidate fees, then persists independent edits", async () => {
    const raw = JSON.parse(JSON.stringify(defaultAlertConfig()));
    delete raw.tokenAlerts.volumeSpikeMinTotalFeesSol;
    delete raw.bscAlerts.volumeSpikeMinTotalFeesBnb;
    delete raw.tokenAlerts.oldTokenVolume.minTotalFeesSol;
    raw.tokenAlerts.minTotalFeesSol = 17;
    raw.bscAlerts.minTotalFeesBnb = 0.7;
    const migrated = alertConfigSchema.parse(raw);
    expect(migrated.tokenAlerts.volumeSpikeMinTotalFeesSol).toBe(17);
    expect(migrated.bscAlerts.volumeSpikeMinTotalFeesBnb).toBe(0.7);
    expect(migrated.tokenAlerts.oldTokenVolume.minTotalFeesSol).toBe(0);
    const file = join(await mkdtemp(join(tmpdir(), "fees-state-")), "state.json");
    const adapter = { getTokenSnapshot: async () => live() };
    const monitor = new RunnerMonitor(adapter, file, true);
    await monitor.init(); await monitor.checkpoint();
    const state = JSON.parse(await readFile(file, "utf8")); state.alertConfig = raw;
    await writeFile(file, JSON.stringify(state));
    const restored = new RunnerMonitor(adapter, file, true); await restored.init();
    await restored.setConfig("tokenAlerts.minTotalFeesSol", "20");
    await restored.setConfig("tokenAlerts.oldTokenVolume.minTotalFeesSol", "3");
    const again = new RunnerMonitor(adapter, file, true); await again.init();
    expect(again.snapshot().alertConfig.tokenAlerts.volumeSpikeMinTotalFeesSol).toBe(17);
    expect(again.snapshot().alertConfig.tokenAlerts.minTotalFeesSol).toBe(20);
    expect(again.snapshot().alertConfig.tokenAlerts.oldTokenVolume.minTotalFeesSol).toBe(3);
  });

  it("does not mislabel a qualified candidate when its fees filter is disabled and data is missing", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "fees-format-")), "state.json");
    const monitor = new RunnerMonitor({ getTokenSnapshot: async () => live() }, file, true);
    await monitor.init(); await monitor.setConfig("tokenAlerts.minTotalFeesSol", "0");
    await monitor.observe({ ...live(), totalFeesNative: null, feesNativeSymbol: undefined });
    const event = monitor.snapshot().pendingAlerts[0];
    expect(event.kind).toBe("candidate");
    expect(event.record.minimumTotalFeesNative).toBe(0);
    const text = formatRunnerNotification(event);
    expect(text).toContain("SOLANA QUALIFIED");
    expect(text).toContain("VOL • MC • AGE");
    expect(text).not.toContain("• FEES");
  });

  it("uses independent legacy spike fees even above the old-volume threshold when that filter fails", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "spike-fees-")), "state.json");
    const monitor = new RunnerMonitor({ getTokenSnapshot: async () => live() }, file, true);
    await monitor.init();
    await monitor.setConfig("tokenAlerts.minTotalFeesSol", "50");
    await monitor.setConfig("tokenAlerts.volumeSpikeMinTotalFeesSol", "2");
    await monitor.setConfig("tokenAlerts.oldTokenVolume.minTotalFeesSol", "100");
    const t = Date.now();
    for (const minute of [0, 5, 10, 15]) await monitor.observe({ ...live(), dexAgeMinutes: 10000,
      totalFeesNative: 2, volume5mUsd: minute === 15 ? 300000 : 40000,
      observedAt: new Date(t + minute * 60000).toISOString() });
    expect(monitor.snapshot().pendingAlerts.map((event) => event.kind)).toEqual(["spike"]);
    expect(monitor.snapshot().pendingAlerts[0].record.minimumTotalFeesNative).toBe(2);
  });
});
