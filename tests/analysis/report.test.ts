import { describe, expect, it } from "vitest";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { formatTelegramReport } from "../../packages/report/src/telegram.js";

describe("Telegram report", () => {
  it("escapes MarkdownV2 punctuation and exposes the fixture source", async () => {
    const result = await new IntelligenceScanner(new FixtureGmgnAdapter()).scan(
      "So11111111111111111111111111111111111111112"
    );
    result.snapshot.name = "Test (token).";
    result.warnings = ["Risk: 1.5% (test)!"];
    const report = formatTelegramReport(result);

    expect(report).toContain("Test \\(token\\)\\.");
    expect(report).toContain("Sumber data: fixture");
    expect(report).toContain("\\- Risk: 1\\.5% \\(test\\)\\!");
    expect(report).not.toMatch(/(?<!\\)[.()!\-]/);
  });
});
