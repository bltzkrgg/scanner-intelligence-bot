import type { TokenSnapshot } from "@sti/shared";

export function normalizeSnapshot(snapshot: TokenSnapshot): TokenSnapshot {
  return {
    ...snapshot,
    symbol: snapshot.symbol.trim().toUpperCase(),
    name: snapshot.name.trim(),
    top10HolderPct: clampPct(snapshot.top10HolderPct),
    bundlerPct: clampPct(snapshot.bundlerPct),
    insiderPct: clampPct(snapshot.insiderPct),
    sniperPct: clampPct(snapshot.sniperPct),
    developerRugRatePct: clampPct(snapshot.developerRugRatePct),
    liquidityLockedPct: clampPct(snapshot.liquidityLockedPct)
  };
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}
