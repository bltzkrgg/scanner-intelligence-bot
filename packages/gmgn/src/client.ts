import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { solanaMintSchema, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "./types.js";

const execFileAsync = promisify(execFile);
const number = z.preprocess((value) => {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return null;
  return typeof value === "string" ? Number(value) : value;
}, z.number().finite().nullable()).default(null);
const positive = number.refine((value) => value === null || value >= 0);
const count = positive.refine((value) => value === null || Number.isInteger(value));
const ratio = positive.refine((value) => value === null || value <= 1);
const tokenSchema = z.object({
  address: solanaMintSchema,
  symbol: z.string().max(80).default("UNKNOWN"),
  name: z.string().max(200).default("Unknown Token"),
  circulating_supply: positive,
  liquidity: positive,
  creation_timestamp: positive,
  holder_count: count,
  price: z.object({
    price: positive, price_1h: positive, price_6h: positive,
    volume_24h: positive, buys_1h: count, sells_1h: count
  }).prefault({}),
  pool: z.object({ liquidity: positive }).prefault({}),
  stat: z.object({ top_10_holder_rate: ratio }).prefault({}),
  dev: z.object({ creator_open_count: count }).prefault({}),
  wallet_tags_stat: z.object({ smart_wallets: count }).prefault({})
});
const securitySchema = z.object({
  top_10_holder_rate: ratio, suspected_insider_hold_rate: ratio,
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

export function parseTokenInfo(input: unknown, mint: string, security?: unknown, now = Date.now()): MarketSnapshot {
  const raw = tokenSchema.parse(unwrapGmgn(input));
  if (raw.address !== mint) throw new ProviderError("Alamat respons GMGN berbeda dari CA yang diminta.");
  const safety = security === undefined ? undefined : securitySchema.parse(unwrapGmgn(security));
  const pct = (value: number | null | undefined) => value == null ? null : value * 100;
  const change = (previous: number | null) => {
    const result = raw.price.price !== null && previous !== null && previous > 0
      ? (raw.price.price / previous - 1) * 100 : null;
    return result !== null && Number.isFinite(result) ? result : null;
  };
  const warnings: string[] = [];
  if (!safety) warnings.push("Data token security belum tersedia.");
  if (safety?.is_wash_trading) warnings.push("Provider menandai indikasi wash trading.");
  const honeypot = safety?.is_honeypot ?? safety?.honeypot;
  if (honeypot === "yes" || honeypot === "1" || honeypot === 1 || honeypot === true) warnings.push("Provider menandai honeypot.");
  if (safety?.renounced_mint === false) warnings.push("Otoritas mint masih aktif menurut provider.");
  if (safety?.renounced_freeze_account === false) warnings.push("Otoritas freeze masih aktif menurut provider.");
  const marketCap = raw.price.price !== null && raw.circulating_supply !== null
    ? raw.price.price * raw.circulating_supply : null;
  return {
    mint, symbol: raw.symbol, name: raw.name, priceUsd: raw.price.price,
    marketCapUsd: marketCap !== null && Number.isFinite(marketCap) ? marketCap : null,
    liquidityUsd: raw.liquidity ?? raw.pool.liquidity,
    ageMinutes: raw.creation_timestamp !== null && raw.creation_timestamp > 0 && raw.creation_timestamp * 1000 <= now
      ? (now - raw.creation_timestamp * 1000) / 60_000 : null,
    holderCount: raw.holder_count, volume24hUsd: raw.price.volume_24h,
    buys1h: raw.price.buys_1h, sells1h: raw.price.sells_1h,
    top10HolderPct: pct(safety?.top_10_holder_rate ?? raw.stat.top_10_holder_rate),
    insiderPct: pct(safety?.suspected_insider_hold_rate),
    // Volume ratios and wallet counts are not supply exposure percentages.
    bundlerPct: null, sniperPct: null, developerRugRatePct: null,
    developerTokenCount: raw.dev.creator_open_count,
    smartMoneyHolderCount: raw.wallet_tags_stat.smart_wallets,
    smartMoneyNetFlowUsd1h: null, liquidityLockedPct: null,
    priceChange1hPct: change(raw.price.price_1h), priceChange6hPct: change(raw.price.price_6h),
    source: "gmgn-cli", observedAt: new Date(now).toISOString(), dataWarnings: warnings
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

  constructor(private readonly run: CliRunner = runCli, private readonly spacingMs = 1200) {}

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

  async getTokenSnapshot(input: string): Promise<MarketSnapshot> {
    const mint = solanaMintSchema.parse(input);
    const cached = this.cache.get(mint);
    if (cached && cached.until > Date.now()) return cached.value;
    const pending = this.pending.get(mint);
    if (pending) return pending;
    const task = this.fetchSnapshot(mint);
    this.pending.set(mint, task);
    try { return await task; } finally { this.pending.delete(mint); }
  }

  private async fetchSnapshot(mint: string): Promise<MarketSnapshot> {
    const raw = await this.request(["token", "info", "--chain", "sol", "--address", mint, "--raw"]);
    // Reject malformed/empty info before spending a second query.
    parseTokenInfo(raw, mint);
    let security: unknown;
    try {
      security = securitySchema.parse(await this.request(["token", "security", "--chain", "sol", "--address", mint, "--raw"]));
    } catch { security = undefined; }
    const snapshot = parseTokenInfo(raw, mint, security);
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(mint, { until: Date.now() + 30_000, value: snapshot });
    return snapshot;
  }

  async discoverTokens(): Promise<string[]> {
    const raw = await this.request(["market", "trending", "--chain", "sol", "--interval", "1h", "--limit", "10", "--raw"]);
    return parseTrending(raw);
  }
}

export function parseTrending(raw: unknown): string[] {
  const item = z.object({ address: solanaMintSchema });
  const result = z.union([z.array(item), z.object({ rank: z.array(item) }), z.object({ list: z.array(item) })]).parse(unwrapGmgn(raw));
  const tokens = Array.isArray(result) ? result : "rank" in result ? result.rank : result.list;
  return [...new Set(tokens.map((token) => token.address))].slice(0, 10);
}
