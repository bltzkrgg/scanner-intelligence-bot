import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEnrichmentDiagnostic, loadConfig, tokenIntelligenceSchema } from "../../packages/shared/src/index.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { RunnerMonitor, formatRunnerNotification, formatRunnerRecord } from "../../packages/analysis/src/runner.js";
import { formatTelegramReport, formatTelegramRisk, formatTelegramRunner } from "../../packages/report/src/telegram.js";
import { providerDiagnostics } from "../../packages/gmgn/src/diagnostics.js";
import { live, mint } from "./live-fixtures.js";

const warnings = [
  "MadeOnSol: enrichment tidak tersedia atau respons tidak valid.",
  "FOMO: enrichment tidak tersedia atau respons tidak valid.",
  "MadeOnSol: HTTP 401: key tidak diterima.",
  "FOMO: timestamp leaderboard kedaluwarsa (>15 menit) atau clock server tidak sesuai."
];

describe("Telegram enrichment warning visibility", () => {
  it("hides provider errors in all runner event kinds without mutating queued diagnostics", async () => {
    const snapshot = { ...live(), dataWarnings: warnings, intelligence: tokenIntelligenceSchema.parse({ sources: ["GMGN"],
      unavailable: { fomo: warnings[1], developer: warnings[0] } }) };
    const adapter = { getTokenSnapshot: async () => snapshot };
    const monitor = new RunnerMonitor(adapter, join(await mkdtemp(join(tmpdir(), "hidden-warning-")), "state.json"), true, ["sol"]);
    await monitor.init(); await monitor.observe(snapshot);
    const event = monitor.snapshot().pendingAlerts[0];
    for (const kind of ["candidate", "spike", "2x", "5x"] as const) {
      const message = formatRunnerNotification({ ...event, kind });
      for (const warning of warnings) expect(message).not.toContain(warning);
      expect(message).not.toContain("Catatan Risiko");
      expect(message).not.toContain("Data Belum Tersedia");
      expect(message).toContain(mint);
    }
    expect(formatRunnerRecord(event.record)).not.toContain("enrichment tidak tersedia");
    expect(event.record.riskNotes).toEqual(warnings);
    expect(providerDiagnostics(loadConfig({}), snapshot).warnings).toEqual(warnings);
    expect(monitor.snapshot().pendingAlerts[0].record.intelligence!.unavailable).toEqual(snapshot.intelligence.unavailable);
    const withRisk = { ...event, record: { ...event.record, riskNotes: [...warnings, "Provider menandai honeypot."] } };
    const message = formatRunnerNotification(withRisk);
    expect(message).toContain("Catatan Risiko");
    expect(message).toContain("Provider menandai honeypot.");
    expect(formatRunnerRecord(withRisk.record)).toContain("Provider menandai honeypot.");
  });

  it("hides diagnostic copies in CA/risk reports and preserves genuine security warnings", async () => {
    const snapshot = { ...live(), dataWarnings: [...warnings, "Provider menandai honeypot."],
      intelligence: tokenIntelligenceSchema.parse({ sources: ["GMGN"], unavailable: { fomo: warnings[1], developer: warnings[0] } }) };
    const result = await new IntelligenceScanner({ getTokenSnapshot: async () => snapshot }).scan(mint);
    for (const message of [formatTelegramReport(result), formatTelegramRisk(result), formatTelegramRunner(result)]) {
      expect(message).not.toContain("enrichment tidak tersedia");
      expect(message).not.toContain("key tidak diterima");
      expect(message).not.toContain("timestamp leaderboard kedaluwarsa");
    }
    expect(formatTelegramReport(result)).toContain("honeypot");
    expect(formatTelegramRisk(result)).toContain("honeypot");
    expect(result.snapshot.dataWarnings).toEqual(snapshot.dataWarnings);
    expect(result.warnings).toContain(warnings[0]);
  });

  it("filters technical errors only, not safety evidence or partial-data qualifiers", () => {
    for (const warning of warnings) expect(isEnrichmentDiagnostic(warning)).toBe(true);
    for (const warning of ["FOMO: Provider menandai honeypot.", "MadeOnSol: indikasi wash trading.",
      "Otoritas mint masih aktif menurut provider.", "FOMO: pencocokan Top 100 parsial dari daftar top holder."]) {
      expect(isEnrichmentDiagnostic(warning)).toBe(false);
    }
  });
});
