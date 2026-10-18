import { describe, expect, it } from "vitest";
import benchmark from "../../research/data/benchmark.fixture.json" with { type: "json" };
import { analyzeToken } from "../../packages/analysis/src/score.js";
import type { BenchmarkToken, TokenSnapshot } from "../../packages/shared/src/types.js";

describe("analyzeToken", () => {
  it("classifies a strong setup without absolute trading language", () => {
    const snapshot: TokenSnapshot = {
      mint: "So11111111111111111111111111111111111111112",
      symbol: "test",
      name: "Test Token",
      marketCapUsd: 900_000,
      liquidityUsd: 100_000,
      ageMinutes: 450,
      volume24hUsd: 1_400_000,
      buys1h: 260,
      sells1h: 170,
      top10HolderPct: 23,
      bundlerPct: 5,
      insiderPct: 4,
      sniperPct: 7,
      developerTokenCount: 3,
      smartMoneyHolderCount: 10,
      smartMoneyNetFlowUsd1h: 36_000,
      priceChange1hPct: 17,
      priceChange6hPct: 40,
      liquidityLockedPct: 77,
      source: "fixture",
      observedAt: "2026-10-06T00:00:00.000Z"
    };

    const result = analyzeToken(snapshot, benchmark as BenchmarkToken[]);

    expect(result.historicalScore).toBeGreaterThanOrEqual(66);
    expect(["SANGAT MENARIK", "CUKUP MENARIK"]).toContain(result.classification);
    expect(result.similarWinRatePct).not.toBeNull();
  });

  it("flags high-risk distribution", () => {
    const weak = {
      ...(benchmark as BenchmarkToken[])[2],
      mint: "So11111111111111111111111111111111111111112"
    };

    const result = analyzeToken(weak, benchmark as BenchmarkToken[]);

    expect(result.classification).toBe("RISIKO TINGGI");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("ignores and removes the retired developer metric from legacy datasets", () => {
    const snapshot = (benchmark as BenchmarkToken[])[0];
    const a = analyzeToken({ ...snapshot, developerRugRatePct: 0 } as TokenSnapshot, benchmark as BenchmarkToken[]);
    const b = analyzeToken({ ...snapshot, developerRugRatePct: 100 } as TokenSnapshot, benchmark as BenchmarkToken[]);
    expect(a.historicalScore).toBe(b.historicalScore);
    expect(a.snapshot).not.toHaveProperty("developerRugRatePct");
    expect(a.metrics.some((m) => m.name === "Riwayat developer")).toBe(false);
  });
});
