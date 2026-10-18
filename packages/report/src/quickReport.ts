import type { IntelligenceResult } from "@sti/shared";

export function buildQuickReport(result: IntelligenceResult): string {
  return result.historicalScore === null
    ? `${result.snapshot.symbol}: skor historis belum tersedia (${result.snapshot.source})`
    : `${result.snapshot.symbol}: ${result.classification} (${result.historicalScore}/100)`;
}
