import type { IntelligenceResult } from "@sti/shared";

export function buildFullReport(result: IntelligenceResult): string {
  return JSON.stringify(result, null, 2);
}
