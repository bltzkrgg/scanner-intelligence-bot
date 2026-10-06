import { z } from "zod";

export const solanaMintSchema = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana mint address");

export type SolanaMint = z.infer<typeof solanaMintSchema>;

export const classificationSchema = z.enum([
  "SANGAT MENARIK",
  "CUKUP MENARIK",
  "NETRAL",
  "KURANG MENARIK",
  "RISIKO TINGGI"
]);

export type IntelligenceClassification = z.infer<typeof classificationSchema>;

export type TokenSnapshot = {
  mint: string;
  symbol: string;
  name: string;
  marketCapUsd: number;
  liquidityUsd: number;
  ageMinutes: number;
  volume24hUsd: number;
  buys1h: number;
  sells1h: number;
  top10HolderPct: number;
  bundlerPct: number;
  insiderPct: number;
  sniperPct: number;
  developerTokenCount: number;
  developerRugRatePct: number;
  smartMoneyHolderCount: number;
  smartMoneyNetFlowUsd1h: number;
  priceChange1hPct: number;
  priceChange6hPct: number;
  liquidityLockedPct: number;
  source: "gmgn-cli" | "fixture" | "manual";
  observedAt: string;
};

export type BenchmarkToken = TokenSnapshot & {
  outcomeReturn24hPct: number;
  outcomeMaxDrawdown24hPct: number;
};

export type MetricScore = {
  name: string;
  value: number;
  percentile: number;
  weight: number;
  direction: "higher_is_better" | "lower_is_better";
};

export type IntelligenceResult = {
  snapshot: TokenSnapshot;
  cohortSize: number;
  classification: IntelligenceClassification;
  historicalScore: number;
  similarWinRatePct: number | null;
  similarMedianReturn24hPct: number | null;
  metrics: MetricScore[];
  warnings: string[];
};
