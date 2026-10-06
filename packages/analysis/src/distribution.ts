import type { MetricScore, TokenSnapshot, BenchmarkToken } from "@sti/shared";
import { percentileRank } from "@sti/benchmark";

export function scoreDistribution(snapshot: TokenSnapshot, cohort: BenchmarkToken[]): MetricScore[] {
  return [
    score("Konsentrasi top holder", snapshot.top10HolderPct, cohort.map((token) => token.top10HolderPct), 0.16, "lower_is_better"),
    score("Bundler exposure", snapshot.bundlerPct, cohort.map((token) => token.bundlerPct), 0.13, "lower_is_better"),
    score("Insider exposure", snapshot.insiderPct, cohort.map((token) => token.insiderPct), 0.13, "lower_is_better"),
    score("Sniper exposure", snapshot.sniperPct, cohort.map((token) => token.sniperPct), 0.1, "lower_is_better")
  ];
}

function score(
  name: string,
  value: number,
  values: number[],
  weight: number,
  direction: MetricScore["direction"]
): MetricScore {
  return {
    name,
    value,
    percentile: percentileRank(values, value, direction),
    weight,
    direction
  };
}
