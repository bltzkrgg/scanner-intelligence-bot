import { normalizeAddress, type Chain, type TokenSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "./types.js";

const fixtureSnapshot: TokenSnapshot = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "MOCK",
  name: "Mock Solana Intelligence Token",
  marketCapUsd: 850_000,
  liquidityUsd: 95_000,
  ageMinutes: 420,
  volume24hUsd: 1_200_000,
  buys1h: 245,
  sells1h: 171,
  top10HolderPct: 24,
  bundlerPct: 6,
  insiderPct: 5,
  sniperPct: 8,
  developerTokenCount: 4,
  developerRugRatePct: 15,
  smartMoneyHolderCount: 9,
  smartMoneyNetFlowUsd1h: 34_000,
  priceChange1hPct: 18,
  priceChange6hPct: 42,
  liquidityLockedPct: 72,
  source: "fixture",
  observedAt: "2026-10-06T00:00:00.000Z"
};

export class FixtureGmgnAdapter implements GmgnAdapter {
  async getTokenSnapshot(mint: string, chain: Chain = "sol"): Promise<TokenSnapshot> {
    return {
      ...fixtureSnapshot,
      chain, mint: normalizeAddress(mint, chain)
    };
  }
}
