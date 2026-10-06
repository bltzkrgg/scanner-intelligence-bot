import type { BenchmarkToken, TokenSnapshot } from "@sti/shared";

export function buildCohort(snapshot: TokenSnapshot, benchmark: BenchmarkToken[]): BenchmarkToken[] {
  const minMarketCap = snapshot.marketCapUsd * 0.25;
  const maxMarketCap = snapshot.marketCapUsd * 4;
  const minAge = Math.max(0, snapshot.ageMinutes * 0.25);
  const maxAge = Math.max(snapshot.ageMinutes * 4, snapshot.ageMinutes + 60);

  return benchmark.filter((token) => {
    return (
      token.marketCapUsd >= minMarketCap &&
      token.marketCapUsd <= maxMarketCap &&
      token.ageMinutes >= minAge &&
      token.ageMinutes <= maxAge
    );
  });
}
