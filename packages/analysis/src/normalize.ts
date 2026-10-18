import type { TokenSnapshot } from "@sti/shared";

export function normalizeSnapshot(snapshot: TokenSnapshot): TokenSnapshot {
  // Old imported datasets may still contain the retired metric; never re-emit it.
  const { developerRugRatePct: _retired, ...current } = snapshot as TokenSnapshot & { developerRugRatePct?: unknown };
  return {
    ...current,
    symbol: snapshot.symbol.trim().toUpperCase(),
    name: snapshot.name.trim(),
    top10HolderPct: clampPct(snapshot.top10HolderPct),
    bundlerPct: clampPct(snapshot.bundlerPct),
    insiderPct: clampPct(snapshot.insiderPct),
    sniperPct: clampPct(snapshot.sniperPct),
    liquidityLockedPct: clampPct(snapshot.liquidityLockedPct)
  };
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}
