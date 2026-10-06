import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TokenSnapshot } from "@sti/shared";
import { gmgnTokenResponseSchema, type GmgnAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

type CliTokenInfo = {
  address?: string;
  token_address?: string;
  symbol?: string;
  name?: string;
  market_cap?: number;
  marketCapUsd?: number;
  liquidity?: number;
  liquidityUsd?: number;
  holder_count?: number;
  top_10_holder_rate?: number;
};

export class CliGmgnAdapter implements GmgnAdapter {
  async getTokenSnapshot(mint: string): Promise<TokenSnapshot> {
    const { stdout } = await execFileAsync(
      "gmgn-cli",
      ["token", "info", "--chain", "sol", "--address", mint, "--raw"],
      { timeout: 20_000, maxBuffer: 1024 * 1024 }
    );
    const raw = JSON.parse(stdout) as CliTokenInfo;

    return gmgnTokenResponseSchema.parse({
      mint: raw.address ?? raw.token_address ?? mint,
      symbol: raw.symbol ?? "UNKNOWN",
      name: raw.name ?? "Unknown Token",
      marketCapUsd: raw.marketCapUsd ?? raw.market_cap ?? 0,
      liquidityUsd: raw.liquidityUsd ?? raw.liquidity ?? 0,
      ageMinutes: 0,
      volume24hUsd: 0,
      buys1h: 0,
      sells1h: 0,
      top10HolderPct: normalizePct(raw.top_10_holder_rate ?? 0),
      bundlerPct: 0,
      insiderPct: 0,
      sniperPct: 0,
      developerTokenCount: 0,
      developerRugRatePct: 0,
      smartMoneyHolderCount: 0,
      smartMoneyNetFlowUsd1h: 0,
      priceChange1hPct: 0,
      priceChange6hPct: 0,
      liquidityLockedPct: 0,
      source: "gmgn-cli",
      observedAt: new Date().toISOString()
    });
  }
}

function normalizePct(value: number): number {
  if (value <= 1) return value * 100;
  return value;
}
