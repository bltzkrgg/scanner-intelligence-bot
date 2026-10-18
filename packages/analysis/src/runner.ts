import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { chainSchema, normalizeAddress, tokenAddressSchema, CHAIN_NAMES, type Chain, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "@sti/gmgn";

export type RunnerAssessment = { score: number | null; candidate: boolean; reasons: string[] };

export function assessRunner(s: MarketSnapshot): RunnerAssessment {
  if (s.source !== "gmgn-cli") return { score: null, candidate: false, reasons: ["Runner memerlukan data live, bukan fixture."] };
  const required = [s.priceUsd, s.liquidityUsd, s.buys1h, s.sells1h, s.priceChange1hPct, s.top10HolderPct, s.smartMoneyHolderCount];
  if (required.some((value) => value == null || !Number.isFinite(value)) || !s.priceUsd || s.priceUsd <= 0) {
    return { score: null, candidate: false, reasons: ["Data harga, aktivitas, smart money, atau risiko belum lengkap."] };
  }
  if (s.runnerBlockReason) {
    return { score: null, candidate: false, reasons: [s.runnerBlockReason] };
  }
  const liquidity = s.liquidityUsd!;
  const buys = s.buys1h!;
  const sells = s.sells1h!;
  const change = s.priceChange1hPct!;
  const ratio = buys / Math.max(sells, 1);
  const score = (liquidity >= 50_000 ? 25 : liquidity >= 25_000 ? 15 : 0)
    + (ratio >= 1.5 ? 25 : ratio >= 1.2 ? 15 : 0)
    + (change >= 10 && change <= 100 ? 20 : change > 0 && change <= 200 ? 10 : 0)
    + (s.smartMoneyHolderCount! >= 3 ? 15 : 0)
    + (s.top10HolderPct! <= 25 ? 15 : s.top10HolderPct! <= 35 ? 5 : 0);
  const candidate = score >= 70 && liquidity >= 25_000 && buys + sells >= 50
    && change > 0 && change <= 200 && s.top10HolderPct! <= 35 && (s.insiderPct === null || s.insiderPct <= 12);
  return {
    score, candidate, reasons: [
      `Likuiditas USD ${liquidity}; buy/sell 1j ${buys}/${sells}.`,
      `Perubahan 1j ${change.toFixed(2)}%; smart money provider ${s.smartMoneyHolderCount}.`,
      `Top 10 ${s.top10HolderPct}%; insider ${s.insiderPct === null ? "belum tersedia, risiko belum dapat dinilai" : `${s.insiderPct}%`}.`,
      ...(s.dataWarnings ?? []),
      "Rule eksperimen, bukan probabilitas profit; belum memakai bank wallet pribadi."
    ]
  };
}

const recordSchema = z.object({
  chain: chainSchema.default("sol"),
  mint: tokenAddressSchema, symbol: z.string(), firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(), initialPrice: z.number().positive(),
  latestPrice: z.number().positive(), peakPrice: z.number().positive(),
  maxDrawdownPct: z.number().min(-100).max(0), score: z.number().nullable(),
  candidate: z.boolean(), observations: z.number().int().positive(),
  liquidityUsd: z.number().nonnegative().nullable().default(null),
  marketCapUsd: z.number().nonnegative().nullable().default(null),
  riskNotes: z.array(z.string()).default([]),
  reached2xAt: z.string().datetime().nullable(), reached5xAt: z.string().datetime().nullable()
}).transform((record) => ({ ...record, mint: normalizeAddress(record.mint, record.chain) }));
const eventSchema = z.object({ id: z.string(), kind: z.enum(["candidate", "2x", "5x"]), record: recordSchema });
const stateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).transform(() => 2 as const),
  paused: z.boolean(), lastCycleAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(), records: z.array(recordSchema).max(150),
  pendingAlerts: z.array(eventSchema).max(450).default([]),
  lastNotificationAt: z.string().datetime().nullable().default(null),
  lastNotificationError: z.string().nullable().default(null)
});
export type RunnerRecord = z.infer<typeof recordSchema>;
export type RunnerState = z.infer<typeof stateSchema>;
export type RunnerEvent = z.infer<typeof eventSchema>;

// One writer process per file. Atomic rename preserves the previous state on interrupted writes.
export class RunnerMonitor {
  private state: RunnerState = {
    version: 2, paused: false, lastCycleAt: null, lastError: null, records: [],
    pendingAlerts: [], lastNotificationAt: null, lastNotificationError: null
  };
  private mutations: Promise<unknown> = Promise.resolve();
  private cycling = false;
  private stopped = false;
  private delivering = false;

  constructor(private readonly adapter: GmgnAdapter, private readonly file: string, readonly enabled: boolean,
    readonly chains: Chain[] = ["sol"]) {}

  async init(): Promise<void> {
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("State runner rusak/tidak terbaca. Pulihkan backup; file tidak ditimpa.");
    }
  }

  snapshot(): RunnerState { return structuredClone(this.state); }
  get active(): boolean { return this.enabled && !this.state.paused && !this.stopped; }
  stop(): void { this.stopped = true; }

  private mutate(update: (next: RunnerState) => void): Promise<void> {
    const task = this.mutations.then(async () => {
      const next = this.snapshot();
      update(next);
      stateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      this.state = next;
    });
    this.mutations = task.catch(() => undefined);
    return task;
  }

  async pause(paused: boolean): Promise<void> {
    if (!this.enabled) throw new Error("Isi RUNNER_ENABLED=true dan GMGN_PROVIDER=cli, lalu restart bot.");
    await this.mutate((next) => { next.paused = paused; });
  }

  async remove(mint: string, chain: Chain = "sol"): Promise<void> {
    mint = normalizeAddress(mint, chain);
    await this.mutate((next) => {
      next.records = next.records.filter((entry) => entry.mint !== mint || entry.chain !== chain);
      next.pendingAlerts = next.pendingAlerts.filter((event) => event.record.mint !== mint || event.record.chain !== chain);
    });
  }

  async observe(s: MarketSnapshot): Promise<void> {
    if (!this.active || s.source !== "gmgn-cli" || s.priceUsd == null || s.priceUsd <= 0) return;
    const assessment = assessRunner(s);
    const chain = s.chain ?? "sol";
    if (!this.chains.includes(chain)) return;
    const mint = normalizeAddress(s.mint, chain);
    await this.mutate((next) => {
      if (next.paused || this.stopped) return;
      const existing = next.records.find((entry) => entry.mint === mint && entry.chain === chain);
      if (existing && s.observedAt <= existing.lastSeenAt) return;
      if (!existing) {
        if (!assessment.candidate || next.records.filter((entry) => entry.chain === chain).length >= 50) return;
        const record: RunnerRecord = {
          chain, mint, symbol: s.symbol, firstSeenAt: s.observedAt, lastSeenAt: s.observedAt,
          initialPrice: s.priceUsd!, latestPrice: s.priceUsd!, peakPrice: s.priceUsd!,
          maxDrawdownPct: 0, score: assessment.score, candidate: true, observations: 1,
          liquidityUsd: s.liquidityUsd, marketCapUsd: s.marketCapUsd,
          riskNotes: s.dataWarnings ?? [],
          reached2xAt: null, reached5xAt: null
        };
        next.records.push(record);
        enqueue(next, "candidate", record);
        return;
      }
      existing.lastSeenAt = s.observedAt;
      existing.latestPrice = s.priceUsd!;
      existing.liquidityUsd = s.liquidityUsd;
      existing.marketCapUsd = s.marketCapUsd;
      existing.riskNotes = s.dataWarnings ?? [];
      existing.peakPrice = Math.max(existing.peakPrice, s.priceUsd!);
      existing.maxDrawdownPct = Math.min(existing.maxDrawdownPct, (s.priceUsd! / existing.peakPrice - 1) * 100);
      existing.score = assessment.score;
      existing.candidate = assessment.candidate;
      existing.observations++;
      if (s.priceUsd! / existing.initialPrice >= 2 && !existing.reached2xAt) {
        existing.reached2xAt = s.observedAt;
        enqueue(next, "2x", existing);
      }
      if (s.priceUsd! / existing.initialPrice >= 5 && !existing.reached5xAt) {
        existing.reached5xAt = s.observedAt;
        enqueue(next, "5x", existing);
      }
    });
  }

  async deliverNotifications(send: (event: RunnerEvent) => Promise<void>): Promise<void> {
    if (!this.active || this.delivering) return;
    this.delivering = true;
    try {
      for (const event of this.snapshot().pendingAlerts.filter((entry) => this.chains.includes(entry.record.chain)).slice(0, 10)) {
        if (!this.active) break;
        try {
          await send(event);
          await this.mutate((next) => {
            next.pendingAlerts = next.pendingAlerts.filter((entry) => entry.id !== event.id);
            next.lastNotificationAt = new Date().toISOString(); next.lastNotificationError = null;
          });
        } catch {
          await this.mutate((next) => {
            next.lastNotificationError = "Notifikasi runner gagal. Periksa chat ID/izin Telegram; antrean dipertahankan.";
          });
          break;
        }
      }
    } finally { this.delivering = false; }
  }

  async cycle(): Promise<void> {
    if (!this.active || this.cycling) return;
    this.cycling = true;
    try {
      let hadError = false;
      for (const chain of this.chains) {
        if (!this.active) break;
        let discovered: string[] = [];
        try { discovered = await this.adapter.discoverTokens?.(chain) ?? []; }
        catch { hadError = true; }
        const tracked = this.state.records.filter((entry) => entry.chain === chain && Date.now() - Date.parse(entry.firstSeenAt) < 7 * 86400_000);
        const addresses = [...new Set([...tracked.map((entry) => entry.mint), ...discovered])];
        for (const mint of addresses) {
          if (!this.active) break;
          try {
            const snapshot = await this.adapter.getTokenSnapshot(mint, chain);
            if (snapshot.chain && snapshot.chain !== chain) throw new Error("Chain mismatch");
            await this.observe({ ...snapshot, chain });
          } catch { hadError = true; }
        }
      }
      await this.mutate((next) => {
        next.lastCycleAt = new Date().toISOString();
        next.lastError = hadError ? "Sebagian query discovery/token gagal. Periksa GMGN; data lama tidak dianggap data baru." : null;
      });
    } catch {
      await this.mutate((next) => {
        next.lastError = "Siklus runner gagal. Periksa GMGN/izin file; data lama tidak dianggap data baru.";
      });
    } finally { this.cycling = false; }
  }
}

export function formatRunnerRecord(record: RunnerRecord, now = Date.now()): string {
  const stale = now - Date.parse(record.lastSeenAt) > 15 * 60_000;
  return [
    `${record.symbol} | ${CHAIN_NAMES[record.chain]} | ${record.mint}`,
    `Status: ${stale ? "DATA LAMA" : record.candidate ? "KANDIDAT" : "MELEMAH / DATA BELUM LENGKAP"}`,
    `Runner Score: ${record.score ?? "belum tersedia"}`,
    ...(record.riskNotes.length ? [`Catatan: ${record.riskNotes.join(" ")}`] : []),
    `Harga USD: ${record.latestPrice}; awal deteksi: ${record.initialPrice}`,
    `Sejak deteksi: ${((record.latestPrice / record.initialPrice - 1) * 100).toFixed(2)}%`,
    `Puncak teramati: ${(record.peakPrice / record.initialPrice).toFixed(2)}x; max drawdown teramati: ${record.maxDrawdownPct.toFixed(2)}%`,
    `2x: ${record.reached2xAt ?? "belum teramati"}; 5x: ${record.reached5xAt ?? "belum teramati"}`,
    `Deteksi: ${record.firstSeenAt}; update: ${record.lastSeenAt}`
  ].join("\n");
}

function enqueue(state: RunnerState, kind: RunnerEvent["kind"], record: RunnerRecord): void {
  const id = `${record.chain}:${record.mint}:${record.firstSeenAt}:${kind}`;
  if (!state.pendingAlerts.some((event) => event.id === id)) {
    state.pendingAlerts.push({ id, kind, record: structuredClone(record) });
  }
}

export function formatRunnerNotification(event: RunnerEvent): string {
  return [
    event.kind === "candidate" ? "KANDIDAT TOKEN RUNNER BARU" : `TOKEN RUNNER: ${event.kind.toUpperCase()} TERAMATI`,
    Date.now() - Date.parse(event.record.lastSeenAt) > 15 * 60_000 ? "NOTIFIKASI TERTUNDA: data saat event, bukan harga terbaru." : "",
    `Jaringan: ${CHAIN_NAMES[event.record.chain]}`,
    formatRunnerRecord(event.record),
    `Likuiditas USD: ${event.record.liquidityUsd ?? "belum tersedia"}; market cap USD: ${event.record.marketCapUsd ?? "belum tersedia"}`,
    `Detail: /runner ${event.record.chain} ${event.record.mint}`,
    `Event ID: ${event.id}`,
    "Harga berdasarkan sampel saat query. Kandidat bukan jaminan kenaikan atau sinyal beli."
  ].join("\n\n");
}
