import { describe, expect, it, vi } from "vitest";
import { loadConfig, tokenIntelligenceSchema } from "@sti/shared";
import { CliGmgnAdapter, parseTokenInfo } from "../../packages/gmgn/src/client.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { formatTelegramReport, formatTelegramRisk } from "../../packages/report/src/telegram.js";
import { formatRunnerNotification, RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, security, mint, evm } from "./live-fixtures.js";

const tagged = { ...info, wallet_tags_stat: { ...info.wallet_tags_stat, bundler_wallets: "42", sniper_wallets: "99" },
  stat: { ...info.stat, top_bundler_trader_percentage: "0.12" } };

describe("GMGN bundler and sniper activity", () => {
  it.each(["sol", "bsc", "robinhood"] as const)("reads counts and volume on %s, not supply exposure", (chain) => {
    const address = chain === "sol" ? mint : evm;
    const s = parseTokenInfo({ ...tagged, address }, address, { ...security, bundler_trader_amount_rate: "0.0673" }, Date.now(), chain);
    expect(s.intelligence).toMatchObject({ bundlerWalletCount: 42, sniperWalletCount: 99 });
    expect(s.intelligence!.bundlerVolumePct).toBeCloseTo(6.73);
    expect(s.bundlerPct).toBeNull(); expect(s.sniperPct).toBeNull();
  });

  it("preserves zero counts/volume and does not replace them with fallback values", () => {
    const s = parseTokenInfo({ ...tagged, wallet_tags_stat: { bundler_wallets: 0, sniper_wallets: 0 } }, mint,
      { ...security, sniper_count: 50, bundler_trader_amount_rate: 0 });
    expect(s.intelligence).toMatchObject({ bundlerWalletCount: 0, sniperWalletCount: 0, bundlerVolumePct: 0 });
  });

  it("falls back to documented security sniper count and stat bundler volume", () => {
    const s = parseTokenInfo({ ...tagged, wallet_tags_stat: {} }, mint, { ...security, sniper_count: "7" });
    expect(s.intelligence).toMatchObject({ bundlerWalletCount: null, sniperWalletCount: 7, bundlerVolumePct: 12 });
    expect(s.bundlerPct).toBeNull(); expect(s.sniperPct).toBeNull();
  });

  it("keeps missing or invalid activity unknown without losing valid market/security data", () => {
    const s = parseTokenInfo({ ...info, wallet_tags_stat: { bundler_wallets: -1, sniper_wallets: 1.5 },
      stat: { top_bundler_trader_percentage: 12 } }, mint,
    { ...security, sniper_count: "invalid", bundler_trader_amount_rate: 2 });
    expect(s.intelligence).toMatchObject({ bundlerWalletCount: null, sniperWalletCount: null, bundlerVolumePct: null });
    expect(s.priceUsd).toBe(1); expect(s.insiderPct).toBe(4);
    expect(s.runnerBlockReason).toBeNull();
  });

  it("gets activity in the existing two GMGN queries with no new holder requests", async () => {
    const run = vi.fn(async (args: string[]) => args[1] === "security" ? security : tagged);
    const s = await new CliGmgnAdapter(run, 0).getTokenSnapshot(mint);
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.intelligence!.bundlerWalletCount).toBe(42);
  });

  it("retains GMGN activity through Tracker 403 and renders correct units in scan and risk", async () => {
    const base = { getTokenSnapshot: async () => parseTokenInfo(tagged, mint, security) };
    const tracker = vi.fn(async () => Response.json({ error: "Insufficient credits for this request" }, { status: 403 }));
    const adapter = new EnrichedAdapter(base, loadConfig({ SOLANA_TRACKER_API_KEY: "SECRET" }), tracker as typeof fetch);
    const result = await new IntelligenceScanner(adapter).scan(mint);
    expect(result.snapshot.intelligence).toMatchObject({ bundlerWalletCount: 42, sniperWalletCount: 99, bundlerVolumePct: 12 });
    for (const report of [formatTelegramReport(result), formatTelegramRisk(result)]) {
      expect(report).toContain("Bundler: 42 wallet");
      expect(report).toContain("Sniper: 99 wallet");
      expect(report).toContain("12% volume");
      expect(report).not.toContain("42% supply");
    }
    expect(tracker).toHaveBeenCalledOnce();
  });

  it("persists GMGN metrics into runner events and renders counts/volume without Tracker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gmgn-activity-"));
    const s = parseTokenInfo(tagged, mint, security);
    const monitor = new RunnerMonitor({ getTokenSnapshot: async () => s }, join(dir, "state.json"), true, ["sol"]);
    await monitor.init(); await monitor.observe(s);
    const event = monitor.snapshot().pendingAlerts[0];
    expect(event).toBeDefined();
    const text = formatRunnerNotification(event);
    expect(text).toMatch(/Bundler\s+: <b>42 wallet<\/b>/);
    expect(text).toMatch(/Sniper\s+: <b>99 wallet<\/b>/);
    expect(text).toMatch(/Bundler vol\.\s+: <b>12% volume<\/b>/);
    expect(text).not.toContain("42% supply");
    const restored = new RunnerMonitor({ getTokenSnapshot: async () => s }, join(dir, "state.json"), true, ["sol"]);
    await restored.init();
    expect(restored.snapshot().pendingAlerts[0].record.intelligence).toMatchObject({ bundlerWalletCount: 42, sniperWalletCount: 99 });
  });

  it("defaults old saved intelligence fields to unknown, not zero", () => {
    const old = tokenIntelligenceSchema.parse({ sources: ["GMGN"] });
    expect(old.bundlerWalletCount).toBeNull(); expect(old.sniperWalletCount).toBeNull(); expect(old.bundlerVolumePct).toBeNull();
  });
});
