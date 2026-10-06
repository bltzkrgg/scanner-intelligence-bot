import type { BenchmarkToken, MetricScore, TokenSnapshot } from "@sti/shared";
import { percentileRank } from "@sti/benchmark";

export function scoreSmartMoney(snapshot: TokenSnapshot, cohort: BenchmarkToken[]): MetricScore[] {
  return [
    {
      name: "Smart money holders",
      value: snapshot.smartMoneyHolderCount,
      percentile: percentileRank(cohort.map((token) => token.smartMoneyHolderCount), snapshot.smartMoneyHolderCount, "higher_is_better"),
      weight: 0.12,
      direction: "higher_is_better"
    },
    {
      name: "Smart money net flow 1j",
      value: snapshot.smartMoneyNetFlowUsd1h,
      percentile: percentileRank(cohort.map((token) => token.smartMoneyNetFlowUsd1h), snapshot.smartMoneyNetFlowUsd1h, "higher_is_better"),
      weight: 0.08,
      direction: "higher_is_better"
    }
  ];
}
