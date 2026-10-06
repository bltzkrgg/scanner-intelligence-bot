import type { BenchmarkToken, MetricScore, TokenSnapshot } from "@sti/shared";
import { percentileRank } from "@sti/benchmark";

export function scoreMomentum(snapshot: TokenSnapshot, cohort: BenchmarkToken[]): MetricScore[] {
  const buySellRatio = snapshot.sells1h === 0 ? snapshot.buys1h : snapshot.buys1h / snapshot.sells1h;
  const cohortRatios = cohort.map((token) => (token.sells1h === 0 ? token.buys1h : token.buys1h / token.sells1h));

  return [
    {
      name: "Momentum beli/jual 1j",
      value: buySellRatio,
      percentile: percentileRank(cohortRatios, buySellRatio, "higher_is_better"),
      weight: 0.08,
      direction: "higher_is_better"
    },
    {
      name: "Perubahan harga 1j",
      value: snapshot.priceChange1hPct,
      percentile: percentileRank(cohort.map((token) => token.priceChange1hPct), snapshot.priceChange1hPct, "higher_is_better"),
      weight: 0.06,
      direction: "higher_is_better"
    }
  ];
}
