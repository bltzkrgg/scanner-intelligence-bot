import type { BenchmarkToken, TokenSnapshot } from "@sti/shared";

const FEATURES: Array<keyof Pick<TokenSnapshot, "marketCapUsd" | "liquidityUsd" | "ageMinutes" | "top10HolderPct">> = [
  "marketCapUsd",
  "liquidityUsd",
  "ageMinutes",
  "top10HolderPct"
];

export function findSimilarTokens(snapshot: TokenSnapshot, benchmark: BenchmarkToken[], limit = 25): BenchmarkToken[] {
  return [...benchmark]
    .map((token) => ({ token, distance: distance(snapshot, token) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit)
    .map(({ token }) => token);
}

function distance(left: TokenSnapshot, right: TokenSnapshot): number {
  return FEATURES.reduce((total, feature) => {
    const denominator = Math.max(Math.abs(left[feature]), Math.abs(right[feature]), 1);
    return total + Math.abs(left[feature] - right[feature]) / denominator;
  }, 0);
}
