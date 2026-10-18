import { describe, expect, it } from "vitest";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { formatTelegramReport } from "../../packages/report/src/telegram.js";
import { live, mint } from "./live-fixtures.js";

describe("Telegram report", () => {
  it("escapes MarkdownV2 punctuation and exposes the source", async () => {
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => live() }).scan(mint);
    result.snapshot.name = "Test (token).";
    result.warnings = ["Risk: 1.5% (test)!"];
    const report = formatTelegramReport(result);

    expect(report).toContain("Test \\(token\\)\\.");
    expect(report).toContain("Sumber data: gmgn\\-cli");
    expect(report).toContain("Risk: 1\\.5% \\(test\\)\\!");
    expect(report).not.toMatch(/(?<!\\)[.()!\-]/);
    expect(report).toContain("belum tersedia");
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
