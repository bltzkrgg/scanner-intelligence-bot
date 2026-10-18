import { z } from "zod";
import type { Chain } from "./chains.js";

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
  chain?: Chain;
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

export type NumericSnapshotField = {
  [K in keyof TokenSnapshot]-?: TokenSnapshot[K] extends number ? K : never
}[keyof TokenSnapshot];

export type MarketSnapshot = Omit<TokenSnapshot, NumericSnapshotField> & {
  [K in NumericSnapshotField]: number | null
} & {
  priceUsd?: number | null;
  holderCount?: number | null;
  dataWarnings?: string[];
  runnerBlockReason?: string | null;
  volume5mUsd?: number | null;
  swaps5m?: number | null;
  totalFeesNative?: number | null;
  feesNativeSymbol?: "SOL" | "BNB" | "ETH";
  dexAgeMinutes?: number | null;
  intelligence?: TokenIntelligence;
};

export const tokenIntelligenceSchema = z.object({
  dex: z.string().max(100).nullable().default(null),
  deployer: z.string().nullable().default(null),
  developerBondedCount: z.number().int().nonnegative().nullable().default(null),
  developerBondRatePct: z.number().min(0).max(100).nullable().default(null),
  developerGraduatedCount: z.number().int().nonnegative().nullable().default(null),
  developerGraduationRatePct: z.number().min(0).max(100).nullable().default(null),
  mintAuthorityRevoked: z.boolean().nullable().default(null),
  freezeAuthorityRevoked: z.boolean().nullable().default(null),
  kolHolderCount: z.number().int().nonnegative().nullable().default(null),
  buys5m: z.number().int().nonnegative().nullable().default(null),
  sells5m: z.number().int().nonnegative().nullable().default(null),
  topHolderPcts: z.array(z.number().min(0).max(100)).max(100).default([]),
  top100ObservedPct: z.number().min(0).max(100).nullable().default(null),
  linkedFundingPct: z.number().min(0).max(100).nullable().default(null),
  fomo: z.object({
    window: z.enum(["24h", "7d", "30d", "all"]),
    matched: z.number().int().nonnegative(), checked: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(), complete: z.boolean(),
    capturedAt: z.string().datetime()
  }).nullable().default(null),
  sources: z.array(z.string()).default([]),
  unavailable: z.partialRecord(z.enum(["fomo", "developer", "linkedFunding"]), z.string().max(240)).default({})
});
export type TokenIntelligence = z.infer<typeof tokenIntelligenceSchema>;

export type MetricScore = {
  name: string;
  value: number;
  percentile: number;
  weight: number;
  direction: "higher_is_better" | "lower_is_better";
};

export type IntelligenceResult = {
  snapshot: MarketSnapshot;
  cohortSize: number;
  classification: IntelligenceClassification | null;
  historicalScore: number | null;
  similarWinRatePct: number | null;
  similarMedianReturn24hPct: number | null;
  metrics: MetricScore[];
  warnings: string[];
};
