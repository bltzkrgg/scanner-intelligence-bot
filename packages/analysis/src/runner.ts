import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { solanaMintSchema, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "@sti/gmgn";

export type RunnerAssessment = { score: number | null; candidate: boolean; reasons: string[] };

export function assessRunner(s: MarketSnapshot): RunnerAssessment {
  if (s.source !== "gmgn-cli") return { score: null, candidate: false, reasons: ["Runner memerlukan data live, bukan fixture."] };
  const required = [s.priceUsd, s.liquidityUsd, s.buys1h, s.sells1h, s.priceChange1hPct, s.top10HolderPct, s.smartMoneyHolderCount];
  if (required.some((value) => value == null || !Number.isFinite(value)) || !s.priceUsd || s.priceUsd <= 0) {
    return { score: null, candidate: false, reasons: ["Data harga, aktivitas, smart money, atau risiko belum lengkap."] };
  }
  if (s.dataWarnings?.some((warning) => /security|honeypot|wash trading|Otoritas/.test(warning))) {
    return { score: null, candidate: false, reasons: ["Pemeriksaan security belum lolos atau belum tersedia."] };
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
      "Rule eksperimen, bukan probabilitas profit; belum memakai bank wallet pribadi."
    ]
  };
}

const recordSchema = z.object({
  mint: solanaMintSchema, symbol: z.string(), firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(), initialPrice: z.number().positive(),
  latestPrice: z.number().positive(), peakPrice: z.number().positive(),
  maxDrawdownPct: z.number().min(-100).max(0), score: z.number().nullable(),
  candidate: z.boolean(), observations: z.number().int().positive(),
  reached2xAt: z.string().datetime().nullable(), reached5xAt: z.string().datetime().nullable()
});
const stateSchema = z.object({
  version: z.literal(1), paused: z.boolean(), lastCycleAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(), records: z.array(recordSchema).max(50)
});
export type RunnerRecord = z.infer<typeof recordSchema>;
export type RunnerState = z.infer<typeof stateSchema>;

// One writer process per file. Atomic rename preserves the previous state on interrupted writes.
export class RunnerMonitor {
  private state: RunnerState = { version: 1, paused: false, lastCycleAt: null, lastError: null, records: [] };
  private mutations: Promise<unknown> = Promise.resolve();
  private cycling = false;
  private stopped = false;

  constructor(private readonly adapter: GmgnAdapter, private readonly file: string, readonly enabled: boolean) {}

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

  async remove(mint: string): Promise<void> {
    solanaMintSchema.parse(mint);
    await this.mutate((next) => { next.records = next.records.filter((entry) => entry.mint !== mint); });
  }

  async observe(s: MarketSnapshot): Promise<void> {
    if (!this.active || s.source !== "gmgn-cli" || s.priceUsd == null || s.priceUsd <= 0) return;
    const assessment = assessRunner(s);
    await this.mutate((next) => {
      if (next.paused || this.stopped) return;
      const existing = next.records.find((entry) => entry.mint === s.mint);
      if (existing && s.observedAt <= existing.lastSeenAt) return;
      if (!existing) {
        if (!assessment.candidate || next.records.length >= 50) return;
        next.records.push({
          mint: s.mint, symbol: s.symbol, firstSeenAt: s.observedAt, lastSeenAt: s.observedAt,
          initialPrice: s.priceUsd!, latestPrice: s.priceUsd!, peakPrice: s.priceUsd!,
          maxDrawdownPct: 0, score: assessment.score, candidate: true, observations: 1,
          reached2xAt: null, reached5xAt: null
        });
        return;
      }
      existing.lastSeenAt = s.observedAt;
      existing.latestPrice = s.priceUsd!;
      existing.peakPrice = Math.max(existing.peakPrice, s.priceUsd!);
      existing.maxDrawdownPct = Math.min(existing.maxDrawdownPct, (s.priceUsd! / existing.peakPrice - 1) * 100);
      existing.score = assessment.score;
      existing.candidate = assessment.candidate;
      existing.observations++;
      if (s.priceUsd! / existing.initialPrice >= 2) existing.reached2xAt ??= s.observedAt;
      if (s.priceUsd! / existing.initialPrice >= 5) existing.reached5xAt ??= s.observedAt;
    });
  }

  async cycle(): Promise<void> {
    if (!this.active || this.cycling) return;
    this.cycling = true;
    try {
      let hadError = false;
      let discovered: string[] = [];
      try { discovered = await this.adapter.discoverTokens?.() ?? []; }
      catch { hadError = true; }
      const tracked = this.state.records.filter((entry) => Date.now() - Date.parse(entry.firstSeenAt) < 7 * 86400_000);
      const addresses = [...new Set([...tracked.map((entry) => entry.mint), ...discovered])];
      for (const mint of addresses) {
        if (!this.active) break;
        try {
          const snapshot = await this.adapter.getTokenSnapshot(mint);
          await this.observe(snapshot);
        } catch { hadError = true; }
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
    `${record.symbol} | ${record.mint}`,
    `Status: ${stale ? "DATA LAMA" : record.candidate ? "KANDIDAT" : "MELEMAH / DATA BELUM LENGKAP"}`,
    `Runner Score: ${record.score ?? "belum tersedia"}`,
    `Sejak deteksi: ${((record.latestPrice / record.initialPrice - 1) * 100).toFixed(2)}%`,
    `Puncak teramati: ${(record.peakPrice / record.initialPrice).toFixed(2)}x; max drawdown teramati: ${record.maxDrawdownPct.toFixed(2)}%`,
    `2x: ${record.reached2xAt ?? "belum teramati"}; 5x: ${record.reached5xAt ?? "belum teramati"}`,
    `Deteksi: ${record.firstSeenAt}; update: ${record.lastSeenAt}`
  ].join("\n");
}
