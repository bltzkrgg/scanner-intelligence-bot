import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { normalizeAddress, tokenAddressSchema, tokenIntelligenceSchema, type Chain, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "./types.js";
import { ProviderDataError, providerFailureReason } from "./http.js";

const execFileAsync = promisify(execFile);
const number = z.preprocess((value) => {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return null;
  return typeof value === "string" ? Number(value) : value;
}, z.number().finite().nullable()).default(null);
const positive = number.refine((value) => value === null || value >= 0);
const count = positive.refine((value) => value === null || Number.isInteger(value));
const ratio = positive.refine((value) => value === null || value <= 1);
const tokenSchema = z.object({
  address: tokenAddressSchema,
  symbol: z.string().max(80).default("UNKNOWN"),
  name: z.string().max(200).default("Unknown Token"),
  circulating_supply: positive,
  liquidity: positive,
  creation_timestamp: positive,
  open_timestamp: positive,
  migrated_timestamp: positive,
  total_fee: positive,
  holder_count: count,
  price: z.object({
    price: positive, price_1h: positive, price_6h: positive,
    volume_24h: positive, volume_5m: positive, swaps_5m: count, buys_1h: count, sells_1h: count,
    buys_5m: count, sells_5m: count
  }).prefault({}),
  pool: z.object({ liquidity: positive }).prefault({}),
  stat: z.object({ top_10_holder_rate: ratio, top_bundler_trader_percentage: ratio.catch(null) }).prefault({}),
  dev: z.object({ creator_open_count: count, creator_address: tokenAddressSchema.nullable().optional() }).prefault({}),
  wallet_tags_stat: z.object({ smart_wallets: count, renowned_wallets: count,
    bundler_wallets: count.catch(null), sniper_wallets: count.catch(null) }).prefault({})
});
const securitySchema = z.object({
  top_10_holder_rate: ratio, suspected_insider_hold_rate: ratio,
  bundler_trader_amount_rate: ratio.catch(null), sniper_count: count.catch(null),
  is_wash_trading: z.boolean().nullable().optional(),
  is_honeypot: z.union([z.string(), z.boolean(), z.number()]).nullable().optional(),
  honeypot: z.union([z.string(), z.boolean(), z.number()]).nullable().optional(),
  renounced_mint: z.boolean().nullable().optional(),
  renounced_freeze_account: z.boolean().nullable().optional()
}).refine((value) => value.top_10_holder_rate !== null || value.suspected_insider_hold_rate !== null
  || value.is_honeypot != null || value.honeypot != null || value.renounced_mint != null
  || value.is_wash_trading != null || value.renounced_freeze_account != null, "Security payload kosong");

export class ProviderError extends Error {}

export function unwrapGmgn(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !("code" in input)) return input;
  const envelope = z.object({ code: z.union([z.number(), z.string()]), data: z.unknown().optional() }).parse(input);
  if (String(envelope.code) !== "0") throw new ProviderError(`GMGN error code ${envelope.code}.`);
  if (envelope.data == null) throw new ProviderError("GMGN mengembalikan data kosong.");
  return envelope.data;
}

export function parseTokenInfo(input: unknown, mint: string, security?: unknown, now = Date.now(), chain: Chain = "sol"): MarketSnapshot {
  const raw = tokenSchema.parse(unwrapGmgn(input));
  mint = normalizeAddress(mint, chain);
  if (normalizeAddress(raw.address, chain) !== mint) throw new ProviderError("Alamat respons GMGN berbeda dari CA yang diminta.");
  const safety = security === undefined ? undefined : securitySchema.parse(unwrapGmgn(security));
  const pct = (value: number | null | undefined) => value == null ? null : value * 100;
  const change = (previous: number | null) => {
    const result = raw.price.price !== null && previous !== null && previous > 0
      ? (raw.price.price / previous - 1) * 100 : null;
    return result !== null && Number.isFinite(result) ? result : null;
  };
  const warnings: string[] = [];
  let runnerBlockReason: string | null = null;
  const block = (reason: string) => { warnings.push(reason); runnerBlockReason = reason; };
  if (!safety) block("Data token security belum tersedia.");
  if (safety?.is_wash_trading) block("Provider menandai indikasi wash trading.");
  const honeypot = safety?.is_honeypot ?? safety?.honeypot;
  if (honeypot === "yes" || honeypot === "1" || honeypot === 1 || honeypot === true) block("Provider menandai honeypot.");
  if (chain === "sol" && safety?.renounced_mint === false) block("Otoritas mint masih aktif menurut provider.");
  if (chain === "sol" && safety?.renounced_freeze_account === false) block("Otoritas freeze masih aktif menurut provider.");
  if (chain !== "sol" && (honeypot == null || !["yes", "no", "1", "0", 1, 0, true, false].includes(honeypot))) {
    if (chain === "bsc") block("Data security honeypot BSC belum tersedia.");
    else warnings.push("Status honeypot RH belum tersedia; kandidat momentum bukan bukti kelulusan pemeriksaan ini.");
  }
  const marketCap = raw.price.price !== null && raw.circulating_supply !== null
    ? raw.price.price * raw.circulating_supply : null;
  const dexOpenedAt = Math.max(raw.migrated_timestamp ?? 0, raw.open_timestamp ?? 0);
  return {
    chain, mint, symbol: raw.symbol, name: raw.name, priceUsd: raw.price.price,
    marketCapUsd: marketCap !== null && Number.isFinite(marketCap) ? marketCap : null,
    liquidityUsd: raw.liquidity ?? raw.pool.liquidity,
    ageMinutes: raw.creation_timestamp !== null && raw.creation_timestamp > 0 && raw.creation_timestamp * 1000 <= now
      ? (now - raw.creation_timestamp * 1000) / 60_000 : null,
    holderCount: raw.holder_count, volume24hUsd: raw.price.volume_24h,
    volume5mUsd: raw.price.volume_5m, swaps5m: raw.price.swaps_5m,
    totalFeesNative: raw.total_fee, feesNativeSymbol: chain === "sol" ? "SOL" : chain === "bsc" ? "BNB" : "ETH",
    dexAgeMinutes: dexOpenedAt > 0 && dexOpenedAt * 1000 <= now ? (now - dexOpenedAt * 1000) / 60_000 : null,
    buys1h: raw.price.buys_1h, sells1h: raw.price.sells_1h,
    top10HolderPct: pct(safety?.top_10_holder_rate ?? raw.stat.top_10_holder_rate),
    insiderPct: pct(safety?.suspected_insider_hold_rate),
    // Volume ratios and wallet counts are not supply exposure percentages.
    bundlerPct: null, sniperPct: null,
    developerTokenCount: raw.dev.creator_open_count,
    smartMoneyHolderCount: raw.wallet_tags_stat.smart_wallets,
    intelligence: tokenIntelligenceSchema.parse({
      deployer: raw.dev.creator_address ?? null, kolHolderCount: raw.wallet_tags_stat.renowned_wallets,
      bundlerWalletCount: raw.wallet_tags_stat.bundler_wallets,
      sniperWalletCount: raw.wallet_tags_stat.sniper_wallets ?? safety?.sniper_count ?? null,
      bundlerVolumePct: pct(safety?.bundler_trader_amount_rate ?? raw.stat.top_bundler_trader_percentage),
      buys5m: raw.price.buys_5m, sells5m: raw.price.sells_5m,
      mintAuthorityRevoked: chain === "sol" ? safety?.renounced_mint ?? null : null,
      freezeAuthorityRevoked: chain === "sol" ? safety?.renounced_freeze_account ?? null : null,
      sources: ["GMGN"]
    }),
    smartMoneyNetFlowUsd1h: null, liquidityLockedPct: null,
    priceChange1hPct: change(raw.price.price_1h), priceChange6hPct: change(raw.price.price_6h),
    source: "gmgn-cli", observedAt: new Date(now).toISOString(), dataWarnings: warnings, runnerBlockReason
  };
}

export type CliRunner = (args: string[]) => Promise<unknown>;

async function runCli(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gmgn-cli", args, {
    timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GMGN_RATE_LIMIT_AUTO_RETRY_MAX_WAIT_MS: "0" }
  });
  return JSON.parse(stdout);
}

export class CliGmgnAdapter implements GmgnAdapter {
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private cache = new Map<string, { until: number; value: MarketSnapshot }>();
  private pending = new Map<string, Promise<MarketSnapshot>>();

  constructor(private readonly run: CliRunner = runCli, private readonly spacingMs = 1200,
    private readonly holderAnalysis = false) {}

  private request(args: string[]): Promise<unknown> {
    const task = this.queue.then(async () => {
      if (Date.now() < this.blockedUntil) throw new ProviderError("GMGN sedang cooldown. Coba lagi setelah 5 menit.");
      const delay = this.nextRequestAt - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        return unwrapGmgn(await this.run(args));
      } catch (error) {
        const details = error as { code?: string; stderr?: string; message?: string };
        const message = `${details.stderr ?? ""} ${details.message ?? ""}`;
        if (/429|RATE_LIMIT|403|401|PLAN_UPGRADE_REQUIRED/.test(message)) {
          this.blockedUntil = Date.now() + 5 * 60_000;
          throw new ProviderError("Akses GMGN ditolak atau rate limit. Periksa API key/paket; query dihentikan 5 menit.");
        }
        if (details.code === "ENOENT") throw new ProviderError("gmgn-cli belum terpasang atau tidak ada pada PATH service.");
        throw new ProviderError("Query GMGN gagal. Periksa kredensial, koneksi, dan versi CLI; tidak ada fallback ke data contoh.");
      } finally {
        this.nextRequestAt = Date.now() + this.spacingMs;
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async getTokenSnapshot(input: string, chain: Chain = "sol", options?: { forceRefresh?: boolean }): Promise<MarketSnapshot> {
    const mint = normalizeAddress(input, chain);
    const key = `${chain}:${mint}`;
    const cached = this.cache.get(key);
    if (!options?.forceRefresh && cached && cached.until > Date.now()) return cached.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.fetchSnapshot(mint, chain);
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }

  private async fetchSnapshot(mint: string, chain: Chain): Promise<MarketSnapshot> {
    const raw = await this.request(["token", "info", "--chain", chain, "--address", mint, "--raw"]);
    // Reject malformed/empty info before spending a second query.
    parseTokenInfo(raw, mint, undefined, Date.now(), chain);
    let security: unknown;
    try {
      security = securitySchema.parse(await this.request(["token", "security", "--chain", chain, "--address", mint, "--raw"]));
    } catch { security = undefined; }
    const snapshot = parseTokenInfo(raw, mint, security, Date.now(), chain);
    if (this.holderAnalysis) {
      try {
        applyHolderAnalysis(snapshot, await this.request(["token", "holders", "--chain", chain, "--address", mint, "--limit", "100", "--raw"]), chain);
      } catch (error) {
        const reason = providerFailureReason("GMGN holder", error);
        snapshot.dataWarnings!.push(reason);
        snapshot.intelligence!.unavailable.linkedFunding = reason;
      }
    } else snapshot.intelligence!.unavailable.linkedFunding = "GMGN_HOLDER_ANALYSIS_ENABLED=false";
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(`${chain}:${mint}`, { until: Date.now() + 10_000, value: snapshot });
    return snapshot;
  }

  async discoverTokens(chain: Chain = "sol"): Promise<string[]> {
    const raw = await this.request(["market", "trending", "--chain", chain, "--interval", "5m", "--limit", "10", "--raw"]);
    return parseTrending(raw, chain);
  }
}

export function applyHolderAnalysis(s: MarketSnapshot, input: unknown, chain: Chain): void {
  const holder = z.object({ address: tokenAddressSchema, amount_percentage: ratio,
    addr_type: z.preprocess((v) => v === "0" ? 0 : v === "2" ? 2 : v, z.number().int().nullable().optional()),
    native_transfer: z.unknown().optional()
  });
  const data = z.union([z.array(z.unknown()), z.object({ list: z.array(z.unknown()) })]).parse(unwrapGmgn(input));
  const rows = Array.isArray(data) ? data : data.list;
  if (!rows.length || rows.length > 100) throw new ProviderDataError("GMGN: data holder kosong atau melebihi batas 100.");
  const valid = rows.flatMap((row) => {
    const result = holder.safeParse(row);
    if (!result.success) return [];
    try { return [{ ...result.data, address: normalizeAddress(result.data.address, chain) }]; }
    catch { return []; }
  });
  const unique = [...new Map(valid.map((r) => [r.address, r])).values()];
  const observed = unique.filter((r) => r.addr_type === 0 && normalizeAddress(r.address, chain) !== s.mint && r.amount_percentage != null);
  const sum = observed.reduce((n, r) => n + r.amount_percentage! * 100, 0);
  if (sum > 100.001 || !observed.length) throw new ProviderDataError("GMGN: cakupan holder normal belum dapat diverifikasi.");
  const groups = new Map<string, { count: number; pct: number }>();
  for (const row of observed) {
    const funding = z.object({ address: z.unknown().optional(), from_address: z.unknown().optional() }).safeParse(row.native_transfer);
    if (!funding.success) continue;
    const addresses = new Set<string>();
    for (const value of [funding.data.address, funding.data.from_address]) {
      if (typeof value !== "string") continue;
      try { addresses.add(normalizeAddress(value, chain)); } catch { /* Missing optional funding must not drop the holder. */ }
    }
    if (addresses.size !== 1) continue;
    const key = [...addresses][0];
    const group = groups.get(key) ?? { count: 0, pct: 0 };
    group.count++; group.pct += row.amount_percentage! * 100; groups.set(key, group);
  }
  const intel = s.intelligence ??= tokenIntelligenceSchema.parse({ sources: ["GMGN"] });
  if (valid.length !== rows.length) s.dataWarnings?.push("GMGN holder: sebagian baris tidak valid diabaikan; cakupan holder parsial.");
  intel.topHolderPcts = observed.map((r) => r.amount_percentage! * 100).sort((a, b) => b - a);
  intel.top100ObservedPct = Math.min(100, sum);
  intel.linkedFundingPct = groups.size ? Math.min(100, Math.max(0, ...[...groups.values()].filter((g) => g.count >= 2).map((g) => g.pct))) : null;
  if (!groups.size) intel.unavailable.linkedFunding = "GMGN tidak menyertakan sumber pendanaan holder yang valid";
  else delete intel.unavailable.linkedFunding;
  // Observed coverage is not a full-supply audit or proof of common ownership.
}

export function parseTrending(raw: unknown, chain: Chain = "sol"): string[] {
  const item = z.object({ address: tokenAddressSchema });
  const result = z.union([z.array(item), z.object({ rank: z.array(item) }), z.object({ list: z.array(item) })]).parse(unwrapGmgn(raw));
  const tokens = Array.isArray(result) ? result : "rank" in result ? result.rank : result.list;
  return [...new Set(tokens.map((token) => normalizeAddress(token.address, chain)))].slice(0, 10);
}
