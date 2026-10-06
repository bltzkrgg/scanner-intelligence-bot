import type { IntelligenceResult } from "@sti/shared";

export function buildQuickReport(result: IntelligenceResult): string {
  return `${result.snapshot.symbol}: ${result.classification} (${result.historicalScore}/100)`;
}
