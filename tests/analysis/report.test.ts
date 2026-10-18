import { describe, expect, it } from "vitest";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { formatTelegramReport, formatTelegramRisk, formatTelegramRunner } from "../../packages/report/src/telegram.js";
import { defaultAlertConfig } from "../../packages/analysis/src/alert-config.js";
import { live, mint } from "./live-fixtures.js";

describe("Telegram report", () => {
  it("escapes MarkdownV2 punctuation and exposes the source", async () => {
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => live() }).scan(mint);
    result.snapshot.name = "Test (token).";
    result.warnings = ["Risk: 1.5% (test)!"];
    const report = formatTelegramReport(result);

    expect(report).toContain("Test \\(token\\)\\.");
    expect(report).toContain("Data GMGN");
    expect(report).toContain("Risk: 1\\.5% \\(test\\)\\!");
    expect(report).not.toMatch(/(?<!\\)[.()!\-|]/);
    expect(report).toContain("belum tersedia");
  });

  it("renders the compact report with rounded prices, signed momentum and WIB time", async () => {
    const s = { ...live(), symbol: "TSI", name: "Tetsuo Super Intelligence", priceUsd: 0.0004860681,
      marketCapUsd: 473860.94, liquidityUsd: 66865.97229097788, volume24hUsd: 5647458.49,
      top10HolderPct: 14.510000000000002, priceChange1hPct: -1.21, priceChange6hPct: 43.75,
      observedAt: "2026-10-18T10:32:03.687Z" };
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => s }).scan(mint);
    const report = formatTelegramReport(result, { alertConfig: defaultAlertConfig(), runnerActive: true });
    expect(report).toContain("$0\\.00048607");
    expect(report).toContain("$473\\.86K");
    expect(report).toContain("$66\\.87K");
    expect(report).toContain("$5\\.65M");
    expect(report).toContain("14\\.51%");
    expect(report).not.toContain("00000000002");
    expect(report).toContain("\\-1\\.21%");
    expect(report).toContain("\\+43\\.75%");
    expect(report).toContain("18 Okt 2026, 17:32:03 WIB");
    expect(report).toContain("Filter alert admin: LOLOS");
    expect(report).toContain(`\`${mint}\``);
    expect(report.length).toBeLessThan(2000);
    expect(report).not.toContain("Developer rug rate");
  });

  it("keeps unavailable values distinct from zeros and retains critical risk warnings", async () => {
    const s = { ...live(), priceUsd: null, volume24hUsd: 0, top10HolderPct: null, holderCount: 0,
      runnerBlockReason: "Provider menandai honeypot.", insiderPct: null };
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => s }).scan(mint);
    const report = formatTelegramReport(result);
    expect(report).toContain("*Harga* belum tersedia");
    expect(report).toContain("*Volume 24j* $0");
    expect(report).toContain("Holder: 0");
    expect(report).toContain("Provider menandai honeypot\\.");
    expect(report).toContain("Benchmark historis: belum tersedia");
    const risk = formatTelegramRisk(result);
    expect(risk).toContain("Insider holdings: belum tersedia");
    expect(risk).toContain("Bundler exposure: belum tersedia");
    expect(risk).not.toContain("Developer rug rate");
  });

  it("escapes provider-controlled text in all views and limits long warning payloads", async () => {
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => live() }).scan(mint);
    result.snapshot.name = "*[fake](https://bad.example) `x`_";
    result.warnings = Array(100).fill("Warning! ".repeat(100));
    for (const report of [formatTelegramReport(result), formatTelegramRisk(result), formatTelegramRunner(result)]) {
      expect(report).toContain("\\*\\[fake\\]");
      expect(report).not.toMatch(/(?<!\\)[.()!\-|]/);
      expect(report.length).toBeLessThan(4096);
    }
  });

  it("does not round very small token prices to zero", async () => {
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => ({ ...live(), priceUsd: 1.2345e-12 }) }).scan(mint);
    expect(formatTelegramReport(result)).toContain("$0\\.000000000001235");
  });

  it("never presents mock scores as an analysis of the input CA", async () => {
    const result = await new IntelligenceScanner(new FixtureGmgnAdapter()).scan(mint);
    const report = formatTelegramReport(result);
    expect(result.historicalScore).toBeNull();
    expect(result.similarWinRatePct).toBeNull();
    expect(result.classification).toBeNull();
    expect(report).toContain("MODE DEMO");
    expect(report).not.toContain("72/100");
    expect(report).not.toContain("CUKUP MENARIK");
    expect(report).not.toContain("Tidak ada warning");
  });
});
