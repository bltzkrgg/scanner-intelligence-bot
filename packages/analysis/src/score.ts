import type { BenchmarkToken, IntelligenceResult, MetricScore, TokenSnapshot } from "@sti/shared";
import { buildCohort, findSimilarTokens } from "@sti/benchmark";
import { normalizeSnapshot } from "./normalize.js";
import { scoreDistribution } from "./distribution.js";
import { scoreDeveloper } from "./developer.js";
import { scoreSmartMoney } from "./smartMoney.js";
import { scoreMomentum } from "./momentum.js";
import { buildWarnings, classifyScore } from "./risk.js";

export function analyzeToken(snapshotInput: TokenSnapshot, benchmark: BenchmarkToken[]): IntelligenceResult {
  const snapshot = normalizeSnapshot(snapshotInput);
  const cohort = buildCohort(snapshot, benchmark);
  const effectiveCohort = cohort.length >= 5 ? cohort : benchmark;
  const metrics: MetricScore[] = [
    ...scoreDistribution(snapshot, effectiveCohort),
    ...scoreDeveloper(snapshot, effectiveCohort),
    ...scoreSmartMoney(snapshot, effectiveCohort),
    ...scoreMomentum(snapshot, effectiveCohort),
    {
      name: "Kualitas likuiditas",
      value: snapshot.liquidityLockedPct,
      percentile: percentileFrom(effectiveCohort.map((token) => token.liquidityLockedPct), snapshot.liquidityLockedPct, "higher_is_better"),
      weight: 0.12,
      direction: "higher_is_better"
    }
  ];
  const historicalScore = weightedScore(metrics);
  const similar = findSimilarTokens(snapshot, effectiveCohort, 25);

  return {
    snapshot,
    cohortSize: effectiveCohort.length,
    classification: classifyScore(historicalScore),
    historicalScore,
    similarWinRatePct: similar.length === 0 ? null : Math.round((similar.filter((token) => token.outcomeReturn24hPct > 0).length / similar.length) * 100),
    similarMedianReturn24hPct: similar.length === 0 ? null : median(similar.map((token) => token.outcomeReturn24hPct)),
    metrics,
    warnings: buildWarnings(snapshot)
  };
}

function percentileFrom(values: number[], value: number, direction: MetricScore["direction"]): number {
  if (values.length === 0) return 50;
  const count = values.filter((candidate) => (direction === "higher_is_better" ? value >= candidate : value <= candidate)).length;
  return Math.round((count / values.length) * 100);
}

function weightedScore(metrics: MetricScore[]): number {
  const totalWeight = metrics.reduce((total, metric) => total + metric.weight, 0);
  const score = metrics.reduce((total, metric) => total + metric.percentile * metric.weight, 0) / totalWeight;
  return Math.round(score);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
}
