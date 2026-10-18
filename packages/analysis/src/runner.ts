import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { chainSchema, normalizeAddress, tokenAddressSchema, tokenIntelligenceSchema, CHAIN_NAMES, type Chain, type MarketSnapshot } from "@sti/shared";
import type { GmgnAdapter } from "@sti/gmgn";
import { alertConfigSchema, defaultAlertConfig, alertsEnabled, alertInterval, maxAlertsPerScan,
  evaluateTokenAlert, evaluateVolumeSpike, volumeSpikeConfig, updateAlertConfig } from "./alert-config.js";

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
  volume5mUsd: z.number().nonnegative().nullable().default(null),
  swaps5m: z.number().int().nonnegative().nullable().default(null),
  totalFeesNative: z.number().nonnegative().nullable().default(null),
  feesNativeSymbol: z.enum(["SOL", "BNB", "ETH"]).nullable().default(null),
  dexAgeMinutes: z.number().nonnegative().nullable().default(null),
  buys1h: z.number().int().nonnegative().nullable().default(null),
  sells1h: z.number().int().nonnegative().nullable().default(null),
  top10HolderPct: z.number().min(0).max(100).nullable().default(null),
  bundlerPct: z.number().min(0).max(100).nullable().default(null),
  sniperPct: z.number().min(0).max(100).nullable().default(null),
  insiderPct: z.number().min(0).max(100).nullable().default(null),
  smartMoneyHolderCount: z.number().int().nonnegative().nullable().default(null),
  name: z.string().max(200).default(""),
  intelligence: tokenIntelligenceSchema.nullable().default(null),
  baselineVolume5mUsd: z.number().nonnegative().nullable().default(null),
  spikeMultiplier: z.number().nonnegative().nullable().default(null),
  qualification: z.enum(["legacy", "configured", "spike"]).default("legacy"),
  reached2xAt: z.string().datetime().nullable(), reached5xAt: z.string().datetime().nullable()
}).transform((record) => ({ ...record, mint: normalizeAddress(record.mint, record.chain) }));
const eventSchema = z.object({ id: z.string(), kind: z.enum(["candidate", "spike", "2x", "5x"]), record: recordSchema });
const baselineSchema = z.object({
  chain: chainSchema, mint: tokenAddressSchema,
  samples: z.array(z.object({ at: z.string().datetime(), volume: z.number().nonnegative() })).max(4),
  lastObservedAt: z.string().datetime(), lastSpikeAt: z.string().datetime().nullable()
});
const stateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]).transform(() => 3 as const),
  paused: z.boolean(), lastCycleAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(), records: z.array(recordSchema).max(150),
  pendingAlerts: z.array(eventSchema).max(1000).default([]),
  alertConfig: alertConfigSchema.prefault({}),
  volumeBaselines: z.array(baselineSchema).max(500).default([]),
  chainPolledAt: z.partialRecord(chainSchema, z.string().datetime()).default({}),
  lastNotificationAt: z.string().datetime().nullable().default(null),
  lastNotificationError: z.string().nullable().default(null)
});
export type RunnerRecord = z.infer<typeof recordSchema>;
export type RunnerState = z.infer<typeof stateSchema>;
export type RunnerEvent = z.infer<typeof eventSchema>;

// One writer process per file. Atomic rename preserves the previous state on interrupted writes.
export class RunnerMonitor {
  private state: RunnerState = {
    version: 3, paused: false, lastCycleAt: null, lastError: null, records: [],
    pendingAlerts: [], lastNotificationAt: null, lastNotificationError: null,
    alertConfig: defaultAlertConfig(), volumeBaselines: [], chainPolledAt: {}
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

  async checkpoint(): Promise<void> { await this.mutate(() => undefined); }

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

  async setConfig(key: string, input: string): Promise<{ key: string; value: unknown }> {
    let updated: { key: string; value: unknown } = { key, value: null };
    await this.mutate((next) => {
      const result = updateAlertConfig(next.alertConfig, key, input);
      next.alertConfig = result.config;
      updated = { key: result.key, value: result.value };
    });
    return updated;
  }

  async remove(mint: string, chain: Chain = "sol"): Promise<void> {
    mint = normalizeAddress(mint, chain);
    await this.mutate((next) => {
      next.records = next.records.filter((entry) => entry.mint !== mint || entry.chain !== chain);
      next.pendingAlerts = next.pendingAlerts.filter((event) => event.record.mint !== mint || event.record.chain !== chain);
      next.volumeBaselines = next.volumeBaselines.filter((entry) => entry.mint !== mint || entry.chain !== chain);
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
      if (!alertsEnabled(next.alertConfig, chain)) return;
      const existing = next.records.find((entry) => entry.mint === mint && entry.chain === chain);
      if (existing && s.observedAt <= existing.lastSeenAt) return;
      let baseline = next.volumeBaselines.find((entry) => entry.chain === chain && entry.mint === mint);
      if (baseline && s.observedAt <= baseline.lastObservedAt) return;
      const now = Date.parse(s.observedAt);
      const previous = baseline?.samples.filter((sample) => {
        const age = now - Date.parse(sample.at);
        return age >= 300000 && age <= 1800000;
      }).slice(-3) ?? [];
      const baselineVolume = previous.length === 3 ? previous.reduce((sum, sample) => sum + sample.volume, 0) / 3 : null;
      const spikeConfig = volumeSpikeConfig(next.alertConfig, chain);
      const spike = spikeConfig !== null && evaluateVolumeSpike(s, next.alertConfig, baselineVolume).passed
        && (!baseline?.lastSpikeAt || now - Date.parse(baseline.lastSpikeAt) >= spikeConfig.volumeSpikeCooldownMin * 60000);
      const qualifies = evaluateTokenAlert(s, next.alertConfig).passed;
      if (spikeConfig && s.volume5mUsd != null && Number.isFinite(s.volume5mUsd) && s.volume5mUsd >= 0) {
        if (!baseline) {
          baseline = { chain, mint, samples: [], lastObservedAt: s.observedAt, lastSpikeAt: null };
          next.volumeBaselines.push(baseline);
        }
        baseline.lastObservedAt = s.observedAt;
        const lastSample = baseline.samples.at(-1);
        if (!lastSample || now - Date.parse(lastSample.at) >= 300000) {
          baseline.samples.push({ at: s.observedAt, volume: s.volume5mUsd });
          baseline.samples = baseline.samples.slice(-4);
        }
        next.volumeBaselines.sort((a, b) => Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt));
        next.volumeBaselines = next.volumeBaselines.slice(0, 500);
      }
      const details = {
        name: s.name, intelligence: s.intelligence ?? null,
        buys1h: s.buys1h, sells1h: s.sells1h, top10HolderPct: s.top10HolderPct,
        bundlerPct: s.bundlerPct, sniperPct: s.sniperPct, insiderPct: s.insiderPct,
        smartMoneyHolderCount: s.smartMoneyHolderCount,
        volume5mUsd: s.volume5mUsd ?? null, swaps5m: s.swaps5m ?? null,
        totalFeesNative: s.totalFeesNative ?? null, feesNativeSymbol: s.feesNativeSymbol ?? null,
        dexAgeMinutes: s.dexAgeMinutes ?? null, baselineVolume5mUsd: baselineVolume,
        spikeMultiplier: baselineVolume && s.volume5mUsd != null ? s.volume5mUsd / baselineVolume : null
      };
      if (!existing) {
        if ((!qualifies && !spike) || next.records.filter((entry) => entry.chain === chain).length >= 50) return;
        const record: RunnerRecord = {
          chain, mint, symbol: s.symbol, firstSeenAt: s.observedAt, lastSeenAt: s.observedAt,
          initialPrice: s.priceUsd!, latestPrice: s.priceUsd!, peakPrice: s.priceUsd!,
          maxDrawdownPct: 0, score: assessment.score, candidate: true, observations: 1,
          ...details, qualification: spike && !qualifies ? "spike" : "configured",
          liquidityUsd: s.liquidityUsd, marketCapUsd: s.marketCapUsd,
          riskNotes: s.dataWarnings ?? [],
          reached2xAt: null, reached5xAt: null
        };
        next.records.push(record);
        enqueue(next, spike && !qualifies ? "spike" : "candidate", record);
        if (spike && baseline) baseline.lastSpikeAt = s.observedAt;
        return;
      }
      existing.lastSeenAt = s.observedAt;
      existing.latestPrice = s.priceUsd!;
      existing.liquidityUsd = s.liquidityUsd;
      existing.marketCapUsd = s.marketCapUsd;
      existing.riskNotes = s.dataWarnings ?? [];
      Object.assign(existing, details);
      existing.peakPrice = Math.max(existing.peakPrice, s.priceUsd!);
      existing.maxDrawdownPct = Math.min(existing.maxDrawdownPct, (s.priceUsd! / existing.peakPrice - 1) * 100);
      existing.score = assessment.score;
      existing.candidate = qualifies || spike;
      existing.observations++;
      if (s.priceUsd! / existing.initialPrice >= 2 && !existing.reached2xAt) {
        existing.reached2xAt = s.observedAt;
        enqueue(next, "2x", existing);
      }
      if (s.priceUsd! / existing.initialPrice >= 5 && !existing.reached5xAt) {
        existing.reached5xAt = s.observedAt;
        enqueue(next, "5x", existing);
      }
      if (spike) {
        existing.qualification = "spike";
        enqueue(next, "spike", existing);
        if (baseline) baseline.lastSpikeAt = s.observedAt;
      }
    });
  }

  async deliverNotifications(send: (event: RunnerEvent) => Promise<void>, chains: Chain[] = this.chains): Promise<void> {
    if (!this.active || this.delivering) return;
    this.delivering = true;
    try {
      const counts: Partial<Record<Chain, number>> = {};
      const pending = this.snapshot().pendingAlerts.filter((entry) => chains.includes(entry.record.chain)
        && this.chains.includes(entry.record.chain) && alertsEnabled(this.state.alertConfig, entry.record.chain));
      let sent = 0;
      for (const event of pending) {
        if (!this.active) break;
        const chain = event.record.chain;
        if (!alertsEnabled(this.state.alertConfig, chain)) continue;
        if ((counts[chain] ?? 0) >= maxAlertsPerScan(this.state.alertConfig, chain)) continue;
        if (sent >= 50) break;
        try {
          await send(event);
          await this.mutate((next) => {
            next.pendingAlerts = next.pendingAlerts.filter((entry) => entry.id !== event.id);
            next.lastNotificationAt = new Date().toISOString(); next.lastNotificationError = null;
          });
          counts[chain] = (counts[chain] ?? 0) + 1;
          sent++;
        } catch {
          await this.mutate((next) => {
            next.lastNotificationError = "Notifikasi runner gagal. Periksa chat ID/izin Telegram; antrean dipertahankan.";
          });
          break;
        }
      }
    } finally { this.delivering = false; }
  }

  async cycle(options: { scheduled?: boolean; now?: number } = {}): Promise<Chain[]> {
    if (!this.active || this.cycling) return [];
    const now = options.now ?? Date.now();
    const chains = this.chains.filter((chain) => alertsEnabled(this.state.alertConfig, chain) && (!options.scheduled
      || now - Date.parse(this.state.chainPolledAt[chain] ?? "1970-01-01T00:00:00.000Z") >= alertInterval(this.state.alertConfig, chain) * 1000));
    if (!chains.length) return [];
    this.cycling = true;
    const polledAt: Partial<Record<Chain, string>> = {};
    try {
      let hadError = false;
      for (const chain of chains) {
        if (!this.active) break;
        if (!alertsEnabled(this.state.alertConfig, chain)) continue;
        polledAt[chain] = new Date(options.now ?? Date.now()).toISOString();
        let discovered: string[] = [];
        try { discovered = await this.adapter.discoverTokens?.(chain) ?? []; }
        catch { hadError = true; }
        const tracked = this.state.records.filter((entry) => entry.chain === chain && Date.now() - Date.parse(entry.firstSeenAt) < 7 * 86400_000);
        const addresses = [...new Set([...tracked.map((entry) => entry.mint), ...discovered])];
        for (const mint of addresses) {
          if (!this.active || !alertsEnabled(this.state.alertConfig, chain)) break;
          try {
            const snapshot = await this.adapter.getTokenSnapshot(mint, chain);
            if (snapshot.chain && snapshot.chain !== chain) throw new Error("Chain mismatch");
            await this.observe({ ...snapshot, chain });
          } catch { hadError = true; }
        }
      }
      await this.mutate((next) => {
        Object.assign(next.chainPolledAt, polledAt);
        next.lastCycleAt = new Date().toISOString();
        next.lastError = hadError ? "Sebagian query discovery/token gagal. Periksa GMGN; data lama tidak dianggap data baru." : null;
      });
    } catch {
      await this.mutate((next) => {
        next.lastError = "Siklus runner gagal. Periksa GMGN/izin file; data lama tidak dianggap data baru.";
      });
    } finally { this.cycling = false; }
    return Object.keys(polledAt) as Chain[];
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
  const id = `${record.chain}:${record.mint}:${record.firstSeenAt}:${kind}${kind === "spike" ? `:${record.lastSeenAt}` : ""}`;
  if (!state.pendingAlerts.some((event) => event.id === id)) {
    if (state.pendingAlerts.length >= 1000) throw new Error("Antrean alert penuh; pengiriman harus dipulihkan sebelum observasi baru disimpan.");
    state.pendingAlerts.push({ id, kind, record: structuredClone(record) });
  }
}

export { formatRunnerNotification } from "./runner-notification.js";
