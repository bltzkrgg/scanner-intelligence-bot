import { z } from "zod";
import type { TokenSnapshot } from "@sti/shared";

export const gmgnTokenResponseSchema = z
  .object({
    mint: z.string(),
    symbol: z.string().default("UNKNOWN"),
    name: z.string().default("Unknown Token"),
    marketCapUsd: z.coerce.number().nonnegative(),
    liquidityUsd: z.coerce.number().nonnegative(),
    ageMinutes: z.coerce.number().nonnegative(),
    volume24hUsd: z.coerce.number().nonnegative(),
    buys1h: z.coerce.number().int().nonnegative(),
    sells1h: z.coerce.number().int().nonnegative(),
    top10HolderPct: z.coerce.number().min(0).max(100),
    bundlerPct: z.coerce.number().min(0).max(100),
    insiderPct: z.coerce.number().min(0).max(100),
    sniperPct: z.coerce.number().min(0).max(100),
    developerTokenCount: z.coerce.number().int().nonnegative(),
    developerRugRatePct: z.coerce.number().min(0).max(100),
    smartMoneyHolderCount: z.coerce.number().int().nonnegative(),
    smartMoneyNetFlowUsd1h: z.coerce.number(),
    priceChange1hPct: z.coerce.number(),
    priceChange6hPct: z.coerce.number(),
    liquidityLockedPct: z.coerce.number().min(0).max(100),
    source: z.enum(["gmgn-cli", "fixture", "manual"]).default("gmgn-cli"),
    observedAt: z.string().datetime()
  })
  .strict();

export type GmgnTokenResponse = z.infer<typeof gmgnTokenResponseSchema>;

export type GmgnAdapter = {
  getTokenSnapshot(mint: string): Promise<TokenSnapshot>;
};
