import { CHAIN_NAMES, isEnrichmentDiagnostic, type IntelligenceResult, type MarketSnapshot } from "@sti/shared";
import { assessRunner, evaluateTokenAlert, type AlertConfig, type RunnerRecord } from "@sti/analysis";

export type TelegramReportContext = {
  alertConfig?: AlertConfig;
  runnerActive?: boolean;
  record?: RunnerRecord;
  runnerSaveFailed?: boolean;
};

export function formatTelegramReport(result: IntelligenceResult, context: TelegramReportContext = {}): string {
  const s = result.snapshot;
  if (s.source === "fixture") return demoReport(result);
  const runner = assessRunner(s);
  const missingRisk = [s.insiderPct, s.bundlerPct, s.sniperPct,
    s.smartMoneyNetFlowUsd1h, s.liquidityLockedPct].some((v) => v == null);
  return [
    heading(result), "", `\`${escapeMarkdown(s.mint)}\``, "",
    `*Harga* ${escapeMarkdown(usd(s.priceUsd))}`,
    `*Market Cap* ${escapeMarkdown(usd(s.marketCapUsd, true))}`,
    `*Likuiditas* ${escapeMarkdown(usd(s.liquidityUsd, true))}`,
    `*Volume 24j* ${escapeMarkdown(usd(s.volume24hUsd, true))}`, "",
    "*Momentum*",
    `1j: *${escapeMarkdown(percent(s.priceChange1hPct, true))}* \\| 6j: *${escapeMarkdown(percent(s.priceChange6hPct, true))}*`,
    escapeMarkdown(`Buy/Sell 1j: ${number(s.buys1h, 0)} / ${number(s.sells1h, 0)}`),
    escapeMarkdown(`Holder: ${number(s.holderCount, 0)} | Smart money: ${number(s.smartMoneyHolderCount, 0)}`), "",
    ...intelligenceSummary(s),
    `*Runner Score: ${runner.score === null ? "belum tersedia" : `${runner.score}/100`}*`,
    escapeMarkdown(runner.candidate ? "Memenuhi rule skor eksperimen, bukan probabilitas profit."
      : "Belum memenuhi rule skor eksperimen / data belum lengkap."),
    escapeMarkdown(alertStatus(result, context)), "",
    "*Risiko*", escapeMarkdown(`Top 10 holder: ${percent(s.top10HolderPct)} supply.`),
    ...riskWarnings(result).slice(0, 2).map((warning) => escapeMarkdown(clip(warning, 180))),
    escapeMarkdown(missingRisk ? "Sebagian data risiko belum tersedia; keamanan belum dapat disimpulkan."
      : "Metrik provider bukan audit keamanan menyeluruh."),
    ...(context.runnerSaveFailed ? [escapeMarkdown("Histori runner gagal disimpan; pemantauan belum diperbarui.")] : []),
    result.historicalScore === null ? escapeMarkdown("Benchmark historis: belum tersedia.")
      : escapeMarkdown(`Skor historis: ${number(result.historicalScore)}/100 | ${result.classification ?? "belum tersedia"}`), "",
    `_${escapeMarkdown(`Data ${source(s.source)} | ${wib(s.observedAt)}`)}_`,
    "_Bukan rekomendasi beli/jual\\._"
  ].join("\n");
}

export function formatTelegramRisk(result: IntelligenceResult): string {
  if (result.snapshot.source === "fixture") return demoReport(result);
  const s = result.snapshot;
  return [heading(result), "", "*Detail Risiko*", "",
    escapeMarkdown(`Top 10 holder: ${percent(s.top10HolderPct)}`),
    escapeMarkdown(`Insider holdings: ${percent(s.insiderPct)}`),
    escapeMarkdown(`Bundler exposure: ${percent(s.bundlerPct)}`),
    escapeMarkdown(`Sniper exposure: ${percent(s.sniperPct)}`), "",
    "*Developer & Smart Money*",
    escapeMarkdown(`Token diluncurkan developer: ${number(s.developerTokenCount, 0)}`),
    escapeMarkdown(`Smart money holder (label GMGN): ${number(s.smartMoneyHolderCount, 0)}`),
    escapeMarkdown(`Smart money net flow 1j: ${usd(s.smartMoneyNetFlowUsd1h)}`),
    escapeMarkdown(`Likuiditas terkunci: ${percent(s.liquidityLockedPct)}`), "",
    ...intelligenceSummary(s, true),
    "*Catatan*",
    ...[...new Set([...(s.runnerBlockReason ? [s.runnerBlockReason] : []), ...result.warnings])]
      .filter((warning) => !isEnrichmentDiagnostic(warning))
      .slice(0, 8).map((warning) => escapeMarkdown(clip(warning, 180))),
    escapeMarkdown("Belum tersedia berarti belum dapat dinilai, bukan nol atau bukti aman."), "",
    `_${escapeMarkdown(`Data ${source(s.source)} | ${wib(s.observedAt)}`)}_`,
    "_Bukan rekomendasi beli/jual\\._"
  ].join("\n");
}

function intelligenceSummary(s: MarketSnapshot, detailed = false): string[] {
  const i = s.intelligence;
  if (!i) return [];
  const authority = (v: boolean | null) => v === null ? "belum tersedia" : v ? "Dicabut" : "AKTIF";
  const lines = [
    `DEX: ${i.dex ?? "belum tersedia"}`,
    `KOL holder: ${number(i.kolHolderCount, 0)}`,
    `Bundler: ${percent(s.bundlerPct)} | Sniper: ${percent(s.sniperPct)}`,
    i.fomo ? `FOMO Top 100 (${i.fomo.window}): ${i.fomo.matched} trader terdeteksi hold (parsial)` : "FOMO Top 100: belum tersedia",
    s.chain === "robinhood"
      ? `Developer: ${number(s.developerTokenCount, 0)} token | Graduated: ${number(i.developerGraduatedCount, 0)} (${percent(i.developerGraduationRatePct)})`
      : `Developer: ${number(s.developerTokenCount, 0)} token | Berhasil bond: ${number(i.developerBondedCount, 0)} (${percent(i.developerBondRatePct)})`,
    ...(detailed ? [
      ...(s.chain === "robinhood" ? ["Graduation RH: mencapai peak market cap $40K menurut MadeOnSol, bukan bonding curve Solana."] : []),
      `Mint authority: ${authority(i.mintAuthorityRevoked)} | Freeze authority: ${authority(i.freezeAuthorityRevoked)}`,
      `Holder teramati (maks. 100 wallet): ${percent(i.top100ObservedPct)} supply`,
      `Kelompok pendanaan terbesar teramati: ${percent(i.linkedFundingPct)} supply; bukan bukti satu pemilik.`,
      `Top wallet: ${i.topHolderPcts.slice(0, 5).map((p) => percent(p)).join(" • ") || "belum tersedia"}`,
      `Sumber enrichment: ${i.sources.join(", ") || "belum tersedia"}`,
      ...Object.entries(i.unavailable).filter(([field]) => field !== "fomo" && field !== "developer")
        .map(([field, reason]) => `Data ${field}: ${clip(reason, 160)}`)
    ] : [])
  ];
  return ["*Intelligence*", ...lines.map(escapeMarkdown), ""];
}

export function formatTelegramRunner(result: IntelligenceResult, context: TelegramReportContext = {}): string {
  if (result.snapshot.source === "fixture") return demoReport(result);
  const s = result.snapshot;
  const runner = assessRunner(s);
  const filter = context.alertConfig ? evaluateTokenAlert(s, context.alertConfig) : undefined;
  const record = context.record;
  return [heading(result), "", "*Status Runner*",
    escapeMarkdown(`Runner Score: ${runner.score === null ? "belum tersedia" : `${runner.score}/100`} (eksperimen)`),
    escapeMarkdown(alertStatus(result, context)),
    ...(filter?.reasons ?? []).map((reason) => escapeMarkdown(clip(reason, 180))),
    escapeMarkdown(`Pemantauan global: ${context.runnerActive ? "AKTIF" : "NONAKTIF"}`), "",
    escapeMarkdown(`Volume 5m: ${usd(s.volume5mUsd, true)} | Swaps 5m: ${number(s.swaps5m, 0)}`),
    escapeMarkdown(`Total fees GMGN: ${number(s.totalFeesNative, 6)} ${s.feesNativeSymbol ?? "native"}`),
    escapeMarkdown(`Umur DEX/migration: ${number(s.dexAgeMinutes)} menit`), "",
    "*Histori Pemantauan*",
    ...(record ? [
      `Harga awal: ${usd(record.initialPrice)} | Terakhir: ${usd(record.latestPrice)}`,
      `Sejak deteksi: ${percent((record.latestPrice / record.initialPrice - 1) * 100, true)}`,
      `Puncak teramati: ${(record.peakPrice / record.initialPrice).toFixed(2)}x`,
      `Max drawdown teramati: ${percent(record.maxDrawdownPct)}`,
      `2x: ${record.reached2xAt ? wib(record.reached2xAt) : "belum teramati"}`,
      `5x: ${record.reached5xAt ? wib(record.reached5xAt) : "belum teramati"}`,
      `Update histori: ${wib(record.lastSeenAt)}`
    ] : ["Belum masuk histori deteksi."]).map(escapeMarkdown),
    ...(context.runnerSaveFailed ? [escapeMarkdown("Gagal menyimpan observasi terbaru; histori di atas belum diperbarui.")] : []), "",
    escapeMarkdown("Filter kandidat baru terpisah dari pemicu spike. Skor belum dikalibrasi lewat backtest; bukan probabilitas profit."),
    `_${escapeMarkdown(`Data ${source(s.source)} | ${wib(s.observedAt)}`)}_`
  ].join("\n");
}

function heading(result: IntelligenceResult): string {
  const s = result.snapshot;
  return `*${escapeMarkdown(`${clip(s.symbol, 40)} | ${clip(s.name, 100)}`)}*\n${escapeMarkdown(`${CHAIN_NAMES[s.chain ?? "sol"]} | ${source(s.source)}`)}`;
}

function alertStatus(result: IntelligenceResult, context: TelegramReportContext): string {
  const status = context.alertConfig ? evaluateTokenAlert(result.snapshot, context.alertConfig).passed ? "LOLOS" : "BELUM LOLOS" : "belum diperiksa";
  return `Filter alert admin: ${status}${context.runnerActive === false ? " | pemantauan nonaktif" : ""}`;
}

function riskWarnings(result: IntelligenceResult): string[] {
  return [...new Set([...(result.snapshot.runnerBlockReason ? [result.snapshot.runnerBlockReason] : []), ...result.warnings])]
    .filter((warning) => !isEnrichmentDiagnostic(warning))
    .filter((warning) => !warning.startsWith("Skor historis belum tersedia:") && warning !== "Data risiko yang belum tersedia bukan bukti token aman.");
}

function demoReport(result: IntelligenceResult): string {
  return ["*MODE DEMO / MOCK*", escapeMarkdown(`CA input: ${result.snapshot.mint}`),
    escapeMarkdown("Ini snapshot contoh yang tetap, bukan data token pada CA tersebut."),
    escapeMarkdown("Skor, klasifikasi, win rate, dan runner tidak dihitung dari fixture."),
    escapeMarkdown("Admin: pasang gmgn-cli, isi GMGN_API_KEY, ubah GMGN_PROVIDER=cli, lalu restart bot.")].join("\n\n");
}

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "belum tersedia" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function usd(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value)) return "belum tersedia";
  if (compact) {
    for (const [unit, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
      if (Math.abs(value) >= unit) return `$${number(value / unit)}${suffix}`;
    }
    return `$${number(value)}`;
  }
  if (value !== 0 && Math.abs(value) < 1e-20) return `$${value.toExponential(3)}`;
  const digits = value !== 0 && Math.abs(value) < 1 ? Math.min(20, Math.max(8, 3 - Math.floor(Math.log10(Math.abs(value))))) : 6;
  return `$${number(value, digits)}`;
}

function percent(value: number | null | undefined, signed = false): string {
  return value == null || !Number.isFinite(value) ? "belum tersedia" : `${signed && value > 0 ? "+" : ""}${number(value)}%`;
}

function source(value: string): string { return value === "gmgn-cli" ? "GMGN" : value; }
function clip(value: string, length: number): string { return value.replace(/[\r\n\t]+/g, " ").slice(0, length); }
function wib(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return "waktu belum tersedia";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second} WIB`;
}
function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
