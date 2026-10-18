import type { GmgnAdapter } from "@sti/gmgn";
import type { BenchmarkToken, IntelligenceResult, MarketSnapshot, TokenSnapshot } from "@sti/shared";
import { normalizeAddress, type Chain } from "@sti/shared";
import { analyzeToken } from "./score.js";

export class IntelligenceScanner {
  constructor(
    private readonly gmgn: GmgnAdapter,
    private readonly benchmark?: BenchmarkToken[],
    readonly chains: Chain[] = ["sol", "bsc", "robinhood"]
  ) {}

  async scan(mintInput: string, chain: Chain = "sol", options?: { forceRefresh?: boolean }): Promise<IntelligenceResult> {
    if (!this.chains.includes(chain)) throw new Error("Jaringan belum diaktifkan.");
    const mint = normalizeAddress(mintInput, chain);
    const raw = await this.gmgn.getTokenSnapshot(mint, chain, options);
    if ((raw.chain && raw.chain !== chain) || normalizeAddress(raw.mint, chain) !== mint) {
      throw new Error("Identitas respons provider tidak sesuai chain/CA yang diminta.");
    }
    const snapshot = { ...raw, mint, chain };
    // Historical scoring requires an explicitly supplied dataset and complete real inputs.
    if (chain === "sol" && snapshot.source !== "fixture" && this.benchmark?.length && isComplete(snapshot)) {
      return analyzeToken(snapshot, this.benchmark);
    }
    return {
      snapshot, cohortSize: 0, classification: null, historicalScore: null,
      similarWinRatePct: null, similarMedianReturn24hPct: null, metrics: [],
      warnings: [
        ...(snapshot.dataWarnings ?? []),
        snapshot.source === "fixture"
          ? "MODE DEMO: snapshot tetap, bukan analisis CA yang dikirim."
          : "Skor historis belum tersedia: benchmark riil dan metrik lengkap diperlukan.",
        ...marketWarnings(snapshot)
      ]
    };
  }
}

function isComplete(snapshot: MarketSnapshot): snapshot is TokenSnapshot {
  const fields: Array<keyof TokenSnapshot> = [
    "marketCapUsd", "liquidityUsd", "ageMinutes", "volume24hUsd", "buys1h", "sells1h",
    "top10HolderPct", "bundlerPct", "insiderPct", "sniperPct", "developerTokenCount",
    "smartMoneyHolderCount", "smartMoneyNetFlowUsd1h",
    "priceChange1hPct", "priceChange6hPct", "liquidityLockedPct"
  ];
  return fields.every((field) => typeof snapshot[field] === "number" && Number.isFinite(snapshot[field]));
}

function marketWarnings(snapshot: MarketSnapshot): string[] {
  const warnings: string[] = [];
  if (snapshot.liquidityUsd !== null && snapshot.liquidityUsd < 25_000) warnings.push("Likuiditas rendah.");
  if (snapshot.top10HolderPct !== null && snapshot.top10HolderPct > 35) warnings.push("Konsentrasi top holder tinggi.");
  warnings.push("Data risiko yang belum tersedia bukan bukti token aman.");
  return warnings;
}
