import type { BenchmarkToken, MetricScore, TokenSnapshot } from "@sti/shared";
import { percentileRank } from "@sti/benchmark";

export function scoreDeveloper(snapshot: TokenSnapshot, cohort: BenchmarkToken[]): MetricScore[] {
  return [
    {
      name: "Riwayat developer",
      value: snapshot.developerRugRatePct,
      percentile: percentileRank(cohort.map((token) => token.developerRugRatePct), snapshot.developerRugRatePct, "lower_is_better"),
      weight: 0.12,
      direction: "lower_is_better"
    }
  ];
}
