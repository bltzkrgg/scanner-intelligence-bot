import { z } from "zod";
import { normalizeAddress, base58AddressSchema, evmAddressSchema, tokenIntelligenceSchema,
  type AppConfig, type Chain, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "./types.js";
import { ProviderHttp } from "./http.js";

const numeric = z.preprocess((v) => v === null || v === undefined || v === "" ? null : typeof v === "string" ? Number(v) : v,
  z.number().finite().nullable()).optional();
const nonnegative = numeric.refine((v) => v == null || v >= 0);
const count = nonnegative.refine((v) => v == null || Number.isSafeInteger(v));
const pct = nonnegative.refine((v) => v == null || v <= 100);
const trackerSchema = z.object({
  token: z.object({ mint: base58AddressSchema, creation: z.object({ creator: base58AddressSchema.optional() }).optional() }),
  pools: z.array(z.object({ tokenAddress: base58AddressSchema, market: z.string().max(100),
    liquidity: z.object({ usd: nonnegative }), lastUpdated: nonnegative })).max(500),
  risk: z.object({ snipers: z.object({ totalPercentage: pct }).optional(),
    bundlers: z.object({ totalPercentage: pct }).optional() }).optional()
});

export type EnrichmentConfig = Pick<AppConfig, "solanaTrackerApiKey" | "heliusApiKey" | "madeonsolApiKey" |
  "fomoApiKey" | "madeonsolEnabled" | "fomoEnabled" | "fomoLeaderboardWindow" | "enrichmentCacheSec">;

export class EnrichedAdapter implements GmgnAdapter {
  private tracker?: ProviderHttp;
  private helius?: ProviderHttp;
  private made?: ProviderHttp;
  private fomo?: ProviderHttp;

  constructor(private readonly base: GmgnAdapter, private readonly config: EnrichmentConfig,
    fetcher: typeof fetch = fetch) {
    const ttl = config.enrichmentCacheSec * 1000;
    if (config.solanaTrackerApiKey) this.tracker = new ProviderHttp("Solana Tracker", "https://data.solanatracker.io",
      { "x-api-key": config.solanaTrackerApiKey }, ttl, fetcher);
    if (config.heliusApiKey) this.helius = new ProviderHttp("Helius", `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(config.heliusApiKey)}`,
      {}, 30000, fetcher);
    if (config.madeonsolEnabled && config.madeonsolApiKey) this.made = new ProviderHttp("MadeOnSol", "https://madeonsol.com/api/v1",
      { authorization: `Bearer ${config.madeonsolApiKey}` }, ttl, fetcher);
    if (config.fomoEnabled && config.fomoApiKey) this.fomo = new ProviderHttp("FOMO", "https://api.fomoapi.io",
      { authorization: `Bearer ${config.fomoApiKey}` }, ttl, fetcher);
  }

  async getTokenSnapshot(address: string, chain: Chain = "sol", options?: { forceRefresh?: boolean }): Promise<MarketSnapshot> {
    const mint = normalizeAddress(address, chain);
    const s = structuredClone(await this.base.getTokenSnapshot(mint, chain, options));
    if (s.source === "fixture") return s;
    if (normalizeAddress(s.mint, chain) !== mint || (s.chain && s.chain !== chain)) throw new Error("Identitas snapshot tidak sesuai.");
    s.intelligence = tokenIntelligenceSchema.parse(s.intelligence ?? {});
    s.dataWarnings = [...(s.dataWarnings ?? [])];
    // Keep provider failures isolated; no enrichment can erase a base security block.
    if (chain === "sol" && this.tracker) await this.optional(s, "Solana Tracker", () => this.trackerToken(s, mint, options?.forceRefresh));
    if (chain === "sol" && this.helius) await this.optional(s, "Helius", () => this.authorities(s, mint, options?.forceRefresh));
    if (chain === "sol" && this.made && s.intelligence.deployer) {
      await this.optional(s, "MadeOnSol", () => this.developer(s, s.intelligence!.deployer!, options?.forceRefresh));
    } else if (chain === "sol" && this.made) s.dataWarnings.push("MadeOnSol: alamat deployer belum tersedia.");
    if (chain === "robinhood" && this.made) {
      await this.optional(s, "MadeOnSol", () => this.robinhoodDeveloper(s, mint, options?.forceRefresh));
    }
    if (this.fomo) await this.optional(s, "FOMO", () => this.fomoHolders(s, mint, chain, options?.forceRefresh));
    return s;
  }

  async discoverTokens(chain: Chain = "sol"): Promise<string[]> {
    if (chain !== "sol" || !this.tracker) return this.base.discoverTokens?.(chain) ?? [];
    // Tracker is primary for Solana discovery; a failure is surfaced, not hidden by fixture data.
    const raw = await this.tracker.request("/search?sortBy=volume_5m&sortOrder=desc&limit=10");
    const parsed = z.object({ status: z.literal("success"), data: z.array(z.object({ mint: base58AddressSchema })) }).parse(raw);
    return [...new Set(parsed.data.map((r) => r.mint))].slice(0, 10);
  }

  private async optional(s: MarketSnapshot, name: string, work: () => Promise<void>): Promise<void> {
    try { await work(); s.intelligence!.sources.push(name); }
    catch { s.dataWarnings!.push(`${name}: enrichment tidak tersedia atau respons tidak valid.`); }
  }

  private async trackerToken(s: MarketSnapshot, mint: string, force = false): Promise<void> {
    const data = trackerSchema.parse(await this.tracker!.request(`/tokens/${mint}`, undefined, force));
    if (data.token.mint !== mint) throw new Error("Token mismatch");
    const fresh = data.pools.filter((p) => p.tokenAddress === mint && p.lastUpdated != null
      && Date.now() - p.lastUpdated >= -60000 && Date.now() - p.lastUpdated <= 15 * 60000);
    const pool = fresh.sort((a, b) => (b.liquidity.usd ?? 0) - (a.liquidity.usd ?? 0))[0];
    s.intelligence!.deployer ??= data.token.creation?.creator ?? null;
    s.intelligence!.dex = pool?.market ?? null;
    // Only documented supply percentages, never bundler counts or trading-volume ratios.
    if (pool) {
      s.bundlerPct ??= data.risk?.bundlers?.totalPercentage ?? null;
      s.sniperPct ??= data.risk?.snipers?.totalPercentage ?? null;
    }
    if (!pool) s.dataWarnings!.push("Solana Tracker: pool terbaru belum tersedia.");
  }

  private async authorities(s: MarketSnapshot, mint: string, force = false): Promise<void> {
    const raw = await this.helius!.request("", { jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }] }, force);
    const data = z.object({ result: z.object({ value: z.object({ owner: z.enum([
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    ]), data: z.object({ parsed: z.object({ type: z.literal("mint"), info: z.object({
      mintAuthority: base58AddressSchema.nullable(), freezeAuthority: base58AddressSchema.nullable()
    }) }) }) }) }) }).parse(raw);
    const info = data.result.value.data.parsed.info;
    s.intelligence!.mintAuthorityRevoked = info.mintAuthority === null;
    s.intelligence!.freezeAuthorityRevoked = info.freezeAuthority === null;
    if (info.mintAuthority !== null || info.freezeAuthority !== null) {
      const warning = "Helius: otoritas mint atau freeze masih aktif.";
      s.dataWarnings!.push(warning); s.runnerBlockReason = s.runnerBlockReason ?? warning;
    }
  }

  private async developer(s: MarketSnapshot, wallet: string, force = false): Promise<void> {
    wallet = base58AddressSchema.parse(wallet);
    const data = z.object({ deployer: z.object({ wallet_address: base58AddressSchema,
      total_tokens_deployed: count, total_bonded: count }) }).parse(
      await this.made!.request(`/deployer-hunter/${wallet}`, undefined, force));
    const d = data.deployer;
    if (d.wallet_address !== wallet || d.total_tokens_deployed == null || d.total_bonded == null
      || d.total_bonded > d.total_tokens_deployed) throw new Error("Invalid deployer totals");
    s.developerTokenCount = d.total_tokens_deployed;
    s.intelligence!.developerBondedCount = d.total_bonded;
    // Documentation uses both 0..1 and 0..100 bonding_rate: derive from explicit counts instead.
    s.intelligence!.developerBondRatePct = d.total_tokens_deployed > 0 ? d.total_bonded / d.total_tokens_deployed * 100 : null;
  }

  private async robinhoodDeveloper(s: MarketSnapshot, mint: string, force = false): Promise<void> {
    let wallet = s.intelligence!.deployer;
    if (!wallet) {
      const data = z.object({ chain: z.literal("robinhood"), token: z.object({ address: evmAddressSchema,
        deployer: z.object({ address: evmAddressSchema }) }) }).parse(
        await this.made!.request(`/rhc/tokens/${mint}`, undefined, force));
      if (normalizeAddress(data.token.address, "robinhood") !== mint) throw new Error("Token mismatch");
      wallet = data.token.deployer.address;
    }
    wallet = normalizeAddress(wallet, "robinhood");
    const data = z.object({ chain: z.literal("robinhood"), deployer: z.object({
      deployer_address: evmAddressSchema, tokens_deployed: count, graduated: count,
      graduation_rate: nonnegative.refine((v) => v == null || v <= 1)
    }) }).parse(await this.made!.request(`/rhc/deployer-hunter/${wallet}`, undefined, force));
    const d = data.deployer;
    if (normalizeAddress(d.deployer_address, "robinhood") !== wallet
      || (d.tokens_deployed != null && d.graduated != null && d.graduated > d.tokens_deployed)) {
      throw new Error("Invalid RH deployer");
    }
    let total = d.tokens_deployed ?? null;
    let graduated = d.graduated ?? null;
    if (total === null || graduated === null) {
      try {
        const page = z.object({ chain: z.literal("robinhood"), address: evmAddressSchema,
          is_deployer: z.literal(true), total: z.number().int().nonnegative(), tokens: z.array(z.object({
            address: evmAddressSchema, is_graduated: z.boolean().nullable().optional()
          })).max(100)
        }).parse(await this.made!.request(`/rhc/deployer-hunter/${wallet}/tokens?limit=100&offset=0`, undefined, force));
        const rows = new Map(page.tokens.map((r) => [normalizeAddress(r.address, "robinhood"), r]));
        if (normalizeAddress(page.address, "robinhood") !== wallet || rows.size > page.total
          || rows.size !== page.tokens.length || (total !== null && total !== page.total)) throw new Error("Invalid RH token history");
        total = page.total;
        if (rows.size === total && page.tokens.every((r) => typeof r.is_graduated === "boolean")) {
          graduated = page.tokens.filter((r) => r.is_graduated).length;
        } else s.dataWarnings!.push("MadeOnSol RH: histori token parsial; jumlah graduated belum dapat dipastikan.");
      } catch { s.dataWarnings!.push("MadeOnSol RH: jumlah token/graduated belum dapat diverifikasi."); }
    }
    if (total !== null && graduated !== null && graduated > total) throw new Error("Invalid RH graduation totals");
    s.intelligence!.deployer = wallet;
    s.developerTokenCount = total;
    s.intelligence!.developerGraduatedCount = graduated;
    s.intelligence!.developerGraduationRatePct = total === 0 ? null
      : total !== null && graduated !== null ? graduated / total * 100
      : d.graduation_rate == null ? null : d.graduation_rate * 100;
  }

  private async fomoHolders(s: MarketSnapshot, mint: string, chain: Chain, force = false): Promise<void> {
    const window = this.config.fomoLeaderboardWindow;
    const board = z.object({ window: z.literal(window), capturedAt: z.string().datetime(), traders: z.array(z.object({
      rank: z.number().int().positive(), userId: z.string().min(1), handle: z.string().min(1)
    })).max(150) }).parse(await this.fomo!.request(`/v2/leaderboard/${window}?limit=100`, undefined, force));
    const age = Date.now() - Date.parse(board.capturedAt);
    if (age > 15 * 60000 || age < -60000) throw new Error("Stale leaderboard");
    const holders = z.object({ scope: z.literal("live-top-holders"), stale: z.boolean().optional(),
      available: z.boolean().optional(), source: z.string().optional(), holders: z.array(z.object({
      handle: z.string(), amount: nonnegative
    })).max(500) }).parse(await this.fomo!.request(`/token/${mint}/holders?chain=${chain === "sol" ? "solana" : chain}&limit=100`, undefined, force));
    if (holders.stale || holders.available === false || holders.source === "live-fomo-stale") throw new Error("Stale holders");
    const holding = new Set(holders.holders.filter((h) => h.amount != null && h.amount > 0).map((h) => h.handle.toLowerCase()));
    const ranked = [...new Map(board.traders.filter((r) => r.rank <= 100).map((r) => [r.userId, r])).values()];
    const matched = ranked.filter((r) => holding.has(r.handle.toLowerCase())).length;
    // Holder endpoint is top-only and has no completeness guarantee: even zero is a partial observation.
    s.intelligence!.fomo = { window, matched, checked: matched, total: ranked.length, complete: false, capturedAt: board.capturedAt };
    s.dataWarnings!.push("FOMO: pencocokan Top 100 parsial dari daftar top holder; tidak membuktikan trader lain tidak hold.");
  }
}
