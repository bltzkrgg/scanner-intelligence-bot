import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig, tokenIntelligenceSchema } from "../../packages/shared/src/index.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { ProviderHttp } from "../../packages/gmgn/src/http.js";
import { applyHolderAnalysis, CliGmgnAdapter } from "../../packages/gmgn/src/client.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { formatTelegramReport, formatTelegramRisk } from "../../packages/report/src/telegram.js";
import { live, mint, otherMint, evm, info, security } from "./live-fixtures.js";

const now = Date.parse("2026-10-18T15:00:00Z");
const wallet = "11111111111111111111111111111111";
const config = () => loadConfig({ SOLANA_TRACKER_API_KEY: "tracker-secret", HELIUS_API_KEY: "helius-secret",
  MADEONSOL_API_KEY: "made-secret", FOMO_API_KEY: "fomo-secret" });
const tracker = () => ({ token: { mint, creation: { creator: wallet } }, pools: [
  { tokenAddress: mint, market: "PumpSwap", liquidity: { usd: 100000 }, lastUpdated: Date.now() }
], risk: { snipers: { totalPercentage: 0 }, bundlers: { totalPercentage: 6.8 } } });
const authority = (active = false) => ({ result: { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  data: { parsed: { type: "mint", info: { mintAuthority: active ? wallet : null, freezeAuthority: null } } } } } });
const board = () => ({ window: "7d", capturedAt: new Date(Date.now()).toISOString(), traders: [
  { rank: 1, userId: "alice", handle: "Alice" }, { rank: 2, userId: "bob", handle: "Bob" },
  { rank: 3, userId: "alice", handle: "Alice" }
] });
function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    let value: unknown;
    if (url.hostname === "data.solanatracker.io") value = url.pathname === "/search"
      ? { status: "success", data: [{ mint }, { mint }] } : tracker();
    else if (url.hostname === "mainnet.helius-rpc.com") value = authority();
    else if (url.hostname === "madeonsol.com") value = { deployer: { wallet_address: wallet,
      total_tokens_deployed: 12, total_bonded: 3, bonding_rate: 25 } };
    else if (url.pathname.includes("leaderboard")) value = board();
    else value = { scope: "live-top-holders", holders: [{ handle: "ALICE", amount: "2" },
      { handle: "Alice", amount: 2 }, { handle: "Bob", amount: 0 }] };
    value = overrides[url.pathname] ?? overrides[url.hostname] ?? value;
    return Response.json(value);
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}
const base = () => ({ getTokenSnapshot: vi.fn(async () => live()), discoverTokens: vi.fn(async () => [otherMint]) });

describe("multi-provider enrichment", () => {
  it("enriches the same snapshot for scans and runner without changing market prices", async () => {
    const fetcher = mockFetch();
    const adapter = new EnrichedAdapter(base(), config(), fetcher);
    const result = await new IntelligenceScanner(adapter).scan(mint);
    const s = result.snapshot;
    expect(s.priceUsd).toBe(1);
    expect(s.bundlerPct).toBeNull();
    expect(s.sniperPct).toBeNull();
    expect(s.intelligence!.sniperWalletCount).toBe(99);
    expect(s.developerTokenCount).toBe(12);
    expect(s.intelligence).toMatchObject({ dex: "PumpSwap", developerBondedCount: 3,
      developerBondRatePct: 25, mintAuthorityRevoked: true, freezeAuthorityRevoked: true,
      fomo: { matched: 1, total: 2, complete: false } });
    expect(s.intelligence!.sources).toEqual(["GMGN", "Solana Tracker", "Helius", "MadeOnSol", "FOMO"]);
    expect(s).not.toHaveProperty("developerRugRatePct");
    const report = formatTelegramReport(result);
    expect(report).toContain("FOMO Top 100");
    expect(report).toContain("parsial");
    expect(formatTelegramRisk(result)).toContain("Mint authority: Dicabut");
    expect(report).not.toMatch(/rug/i);
    const file = join(await mkdtemp(join(tmpdir(), "enriched-runner-")), "state.json");
    const monitor = new RunnerMonitor(adapter, file, true, ["sol"]);
    await monitor.init(); await monitor.observe(s);
    const event = monitor.snapshot().pendingAlerts[0];
    expect(event.record.intelligence).toEqual(s.intelligence);
    const text = formatRunnerNotification(event);
    expect(text).toContain("INTELLIGENCE");
    expect(text).toContain("PumpSwap");
    expect(text).toContain("1 terdeteksi • 7d • parsial");
    expect(text).toContain("99 wallet");
    expect(text).not.toContain("6.8% supply");
    expect(text).not.toContain("0% supply");
    const restarted = new RunnerMonitor(adapter, file, true, ["sol"]);
    await restarted.init();
    expect(restarted.snapshot().pendingAlerts[0]).toEqual(event);
    await adapter.getTokenSnapshot(mint);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await adapter.getTokenSnapshot(mint, "sol", { forceRefresh: true });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("uses Tracker discovery only on Solana and never sends Solana credentials for EVM", async () => {
    const b = base(); const fetcher = mockFetch();
    const adapter = new EnrichedAdapter(b, config(), fetcher);
    expect(await adapter.discoverTokens("sol")).toEqual([mint]);
    expect(b.discoverTokens).not.toHaveBeenCalled();
    await adapter.discoverTokens("bsc");
    expect(b.discoverTokens).toHaveBeenCalledWith("bsc");
    const evmBase = { getTokenSnapshot: async () => ({ ...live(), chain: "bsc" as const, mint: evm }) };
    fetcher.mockClear();
    const s = await new EnrichedAdapter(evmBase, config(), fetcher).getTokenSnapshot(evm, "bsc");
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).hostname === "api.fomoapi.io")).toBe(true);
    expect(s.intelligence!.mintAuthorityRevoked).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("chain=bsc"))).toBe(true);
  });

  it("does no external queries without keys or in fixture mode", async () => {
    const fetcher = mockFetch();
    await new EnrichedAdapter(base(), loadConfig({}), fetcher).getTokenSnapshot(mint);
    const fixture = await new EnrichedAdapter(new FixtureGmgnAdapter(), config(), fetcher).getTokenSnapshot(mint);
    expect(fixture.source).toBe("fixture");
    expect(fetcher).not.toHaveBeenCalled();
    await new EnrichedAdapter(base(), loadConfig({ FOMO_API_KEY: "secret", MADEONSOL_API_KEY: "secret",
      FOMO_ENABLED: "false", MADEONSOL_ENABLED: "false" }), fetcher).getTokenSnapshot(mint);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("isolates failures, rejects mismatched token/deployer, and never removes security blocks", async () => {
    const fetcher = mockFetch({ "data.solanatracker.io": { ...tracker(), token: { mint: otherMint } },
      "mainnet.helius-rpc.com": authority(true) });
    const blocked = base();
    blocked.getTokenSnapshot.mockResolvedValue({ ...live(), runnerBlockReason: "Provider menandai honeypot." });
    const s = await new EnrichedAdapter(blocked, config(), fetcher).getTokenSnapshot(mint);
    expect(s.runnerBlockReason).toBe("Provider menandai honeypot.");
    expect(s.intelligence!.mintAuthorityRevoked).toBe(false);
    expect(s.dataWarnings!.join(" ")).toContain("Solana Tracker");
    expect(s.intelligence!.dex).toBeNull();
    const wrongDev = await new EnrichedAdapter(base(), config(), mockFetch({ "madeonsol.com": {
      deployer: { wallet_address: otherMint, total_tokens_deployed: 12, total_bonded: 3 }
    } })).getTokenSnapshot(mint);
    expect(wrongDev.intelligence!.developerBondedCount).toBeNull();
    expect(wrongDev.developerTokenCount).toBe(4);
  });

  it("does not treat stale holders, unavailable data, or a stale board as zero matches", async () => {
    for (const override of [{ scope: "live-top-holders", stale: true, holders: [] },
      { scope: "live-top-holders", source: "live-fomo-stale", holders: [] },
      { scope: "tracked-traders", holders: [] }, { available: false }]) {
      const fetcher = mockFetch({ [`/token/${mint}/holders`]: override });
      const s = await new EnrichedAdapter(base(), config(), fetcher).getTokenSnapshot(mint);
      expect(s.intelligence!.fomo).toBeNull();
      expect(s.dataWarnings!.some((w) => w.startsWith("FOMO:"))).toBe(true);
    }
    const s = await new EnrichedAdapter(base(), config(), mockFetch({ "/v2/leaderboard/7d": {
      ...board(), capturedAt: "2020-01-01T00:00:00Z"
    } })).getTokenSnapshot(mint);
    expect(s.intelligence!.fomo).toBeNull();
  });

  it("does not equate no deployments with a zero-percent bond rate or use stale Tracker risk data", async () => {
    const s = await new EnrichedAdapter(base(), config(), mockFetch({ "madeonsol.com": {
      deployer: { wallet_address: wallet, total_tokens_deployed: 0, total_bonded: 0 }
    } })).getTokenSnapshot(mint);
    expect(s.intelligence!.developerBondRatePct).toBeNull();
    const stale = tracker(); stale.pools[0].lastUpdated = now - 86400000;
    const old = await new EnrichedAdapter(base(), config(), mockFetch({ "data.solanatracker.io": stale })).getTokenSnapshot(mint);
    expect(old.bundlerPct).toBeNull(); expect(old.intelligence!.dex).toBeNull();
  });

  it("loads old runner snapshots without inventing enrichment or changing queued IDs", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "enrichment-old-")), "state.json");
    const monitor = new RunnerMonitor(base(), file, true, ["sol"]);
    await monitor.init(); await monitor.observe(live());
    const before = monitor.snapshot().pendingAlerts[0];
    const state = JSON.parse(await readFile(file, "utf8"));
    for (const r of [...state.records, ...state.pendingAlerts.map((e: { record: object }) => e.record)]) {
      delete r.intelligence; delete r.name;
    }
    await writeFile(file, JSON.stringify(state));
    const restored = new RunnerMonitor(base(), file, true, ["sol"]); await restored.init();
    const after = restored.snapshot().pendingAlerts[0];
    expect(after.id).toBe(before.id); expect(after.record.intelligence).toBeNull();
    expect(after.record.latestPrice).toBe(before.record.latestPrice);
  });
});

describe("provider transport and holder analysis", () => {
  it("deduplicates inflight calls, protects cached values, and sanitizes errors/cooldowns", async () => {
    const fetcher = vi.fn(async () => Response.json({ a: [1] })) as unknown as typeof fetch;
    const http = new ProviderHttp("Test", "https://example.test", { authorization: "secret" }, 300000, fetcher);
    const [a] = await Promise.all([http.request("/same"), http.request("/same")]);
    (a as { a: number[] }).a.push(2);
    expect(await http.request("/same")).toEqual({ a: [1] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => new Response("secret token https://secret.example", { status: 429,
      headers: { "retry-after": "600" } })) as unknown as typeof fetch;
    const denied = new ProviderHttp("Test", "https://example.test", {}, 300000, failing);
    await expect(denied.request("/a")).rejects.toThrow("Test: HTTP 429: rate limit");
    await expect(denied.request("/b")).rejects.toThrow("cooldown");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("deduplicates holders, excludes pools/self holdings, and labels funding groups as observations", () => {
    const s = live();
    applyHolderAnalysis(s, { list: [
      { address: wallet, addr_type: 0, amount_percentage: 0.029, native_transfer: { from_address: mint } },
      { address: otherMint, addr_type: 0, amount_percentage: 0.028, native_transfer: { from_address: mint } },
      { address: otherMint, addr_type: 0, amount_percentage: 0.028, native_transfer: { from_address: mint } },
      { address: mint, addr_type: 0, amount_percentage: 0.5 }
    ] }, "sol");
    expect(s.intelligence!.topHolderPcts).toHaveLength(2);
    expect(s.intelligence!.topHolderPcts[0]).toBeCloseTo(2.9);
    expect(s.intelligence!.topHolderPcts[1]).toBeCloseTo(2.8);
    expect(s.intelligence!.top100ObservedPct).toBeCloseTo(5.7);
    expect(s.intelligence!.linkedFundingPct).toBeCloseTo(5.7);
    expect(s.bundlerPct).toBeNull();
    expect(() => applyHolderAnalysis(s, { list: [] }, "sol")).toThrow();
    expect(() => applyHolderAnalysis(s, [{ address: wallet, addr_type: 0, amount_percentage: 1.2 }], "sol")).toThrow();
  });

  it("adds holder queries only when explicitly enabled, preserving CLI security and 5m/KOL fields", async () => {
    const run = vi.fn(async (args: string[]) => args[1] === "holders" ? { list: [
      { address: wallet, addr_type: 0, amount_percentage: "0.1" }
    ] } : args[1] === "security" ? security : { ...info, price: { ...info.price, buys_5m: 56, sells_5m: 44 },
      wallet_tags_stat: { smart_wallets: 8, renowned_wallets: 4 } });
    const s = await new CliGmgnAdapter(run, 0, true).getTokenSnapshot(mint);
    expect(run).toHaveBeenCalledTimes(3);
    expect(s.intelligence).toMatchObject({ kolHolderCount: 4, buys5m: 56, sells5m: 44, topHolderPcts: [10] });
    expect(tokenIntelligenceSchema.parse({}).fomo).toBeNull();
  });
});
