import { CHAIN_NAMES, isEnrichmentDiagnostic } from "@sti/shared";
import type { RunnerEvent } from "./runner.js";

export function formatRunnerNotification(event: RunnerEvent, now = Date.now()): string {
  const r = event.record;
  const i = r.intelligence;
  const network = r.chain === "sol" ? "SOLANA" : r.chain === "bsc" ? "BSC" : "ROBINHOOD";
  const badge = r.chain === "sol" ? "🟣" : r.chain === "bsc" ? "🟡" : "🟢";
  const short = r.chain === "robinhood" ? "RH" : network;
  const native = r.chain === "sol" ? "SOL" : r.chain === "bsc" ? "BNB" : "ETH";
  const hasFees = present(r.totalFeesNative) && r.feesNativeSymbol === native;
  const complete = present(r.volume5mUsd) && hasFees
    && (r.chain === "robinhood" || (present(r.marketCapUsd) && present(r.dexAgeMinutes)));
  const legacy = r.qualification === "legacy";
  const delayed = now - Date.parse(r.lastSeenAt) > 15 * 60000;
  const market = block("MARKET", [
    ["Price", usd(r.latestPrice)], ["MC", usd(r.marketCapUsd, true)],
    ["Vol 5m", usd(r.volume5mUsd, true)], ["Swaps 5m", number(r.swaps5m, 0)],
    ["Fees", hasFees ? `${number(r.totalFeesNative, r.totalFeesNative! > 0 && r.totalFeesNative! < 0.01 ? 8 : 2)} ${native}` : "N/A"],
    ["Liquidity", usd(r.liquidityUsd, true)]
  ]);
  const has5m = present(i?.buys5m) && present(i?.sells5m);
  const buys = has5m ? i!.buys5m : r.buys1h;
  const sells = has5m ? i!.sells5m : r.sells1h;
  const totalSwaps = present(buys) && present(sells) ? buys + sells : 0;
  const buyPct = totalSwaps > 0 ? Math.round(buys! / totalSwaps * 100) : null;
  const activity = block("ACTIVITY", [
    [has5m ? "Flow 5m" : "Flow 1h", buyPct !== null ? `Buy ${buyPct}% • Sell ${100 - buyPct}%` : "N/A"],
    ["Top 10", present(r.top10HolderPct) ? `${number(r.top10HolderPct)}%` : "N/A"],
    ["Wallets", i?.topHolderPcts.length ? i.topHolderPcts.slice(0, 5).map((p) => `${number(p)}%`).join(" • ") : "N/A"],
    ["Dex Paid", "N/A"]
  ]);
  const intelligence = i && (i.sources.some((s) => s !== "GMGN") || i.topHolderPcts.length || present(i.kolHolderCount)) ? block("INTELLIGENCE", [
    ["Smart Money", number(r.smartMoneyHolderCount, 0)],
    ["KOL", number(i.kolHolderCount, 0)],
    ["FOMO Top 100", i.fomo ? `${i.fomo.matched} terdeteksi • ${i.fomo.window} • parsial` : "N/A"],
    ["Bundler", present(r.bundlerPct) ? `${number(r.bundlerPct)}% supply` : "N/A"],
    ["Sniper", present(r.sniperPct) ? `${number(r.sniperPct)}% supply` : "N/A"],
    [r.chain === "robinhood" ? "Dev graduated" : "Dev bonded", r.chain === "robinhood"
      ? `${number(i.developerGraduatedCount, 0)} • ${present(i.developerGraduationRatePct) ? `${number(i.developerGraduationRatePct)}%` : "N/A"}`
      : i.developerBondedCount !== null ? `${number(i.developerBondedCount, 0)} • ${number(i.developerBondRatePct)}%` : "N/A"],
    ["Linked funding", present(i.linkedFundingPct) ? `${number(i.linkedFundingPct)}% teramati` : "N/A"]
  ]) : null;
  let status: string;
  let detail: string;
  if (event.kind === "volume") {
    status = r.volumeTrigger === "spike" ? "🟢 VOLUME SPIKE"
      : r.volumeTrigger === "crossing" ? "🟢 VOLUME TEMBUS BATAS" : "🟢 VOLUME TINGGI TERDETEKSI";
    detail = `Volume ≥ ${usd(r.volumeThresholdUsd, true)}/5m`;
  } else if (event.kind === "2x" || event.kind === "5x") {
    status = `🟢 ${event.kind.toUpperCase()} TERAMATI`;
    detail = `${number(r.latestPrice / r.initialPrice)}x dari deteksi\nHarga awal: ${usd(r.initialPrice)}`;
  } else if (legacy) {
    status = "HISTORI DETEKSI LAMA";
    detail = `Filter ${short} terbaru\nbelum terverifikasi`;
  } else if (event.kind === "spike") {
    const spikeComplete = r.chain !== "robinhood" && complete && present(r.baselineVolume5mUsd) && r.baselineVolume5mUsd > 0
      && present(r.spikeMultiplier) && present(r.swaps5m) && present(r.liquidityUsd);
    status = spikeComplete ? `🟢 ${short} VOLUME SPIKE` : "DATA SPIKE BELUM LENGKAP";
    detail = `Lonjakan: ${present(r.spikeMultiplier) ? `${number(r.spikeMultiplier)}x` : "N/A"}\nBaseline: ${usd(r.baselineVolume5mUsd, true)}`;
  } else {
    status = complete && r.qualification === "configured" ? `🟢 ${short} QUALIFIED` : "DATA DETEKSI BELUM LENGKAP";
    detail = complete ? r.chain === "robinhood" ? "VOL • FEES" : "VOL • MC • FEES • AGE"
      : "Data wajib N/A.\nFilter belum terverifikasi.";
  }
  const notes = r.riskNotes.filter((note) => !isEnrichmentDiagnostic(note)).slice(0, 3).map((note) => escapeHtml(clip(note, 180)));
  const unavailable = Object.entries(i?.unavailable ?? {}).filter(([field]) => field !== "fomo" && field !== "developer");
  return [
    `<b>${badge} ${network} ${event.kind === "volume" ? "VOLUME ALERT" : "TOKEN RUNNER"}</b>`, "",
    `<b>💊 ${escapeHtml(clip(r.symbol, 40))}${present(r.dexAgeMinutes) ? ` • ${age(r.dexAgeMinutes)}` : ""}</b>`,
    escapeHtml(`${r.name ? `${clip(r.name, 80)} | ` : ""}${i?.dex ?? `${CHAIN_NAMES[r.chain]} | GMGN`}`), "",
    ...(delayed ? ["<b>⚠️ ALERT TERTUNDA</b>", "Data saat event, bukan harga terbaru.", ""] : []),
    market, "", activity, "", ...(intelligence ? [intelligence, ""] : []),
    ...(event.kind === "volume" ? [block("MOMENTUM", [
      ["Baseline 5m", usd(r.baselineVolume5mUsd, true)],
      ["Lonjakan", present(r.spikeMultiplier) ? `${number(r.spikeMultiplier)}x` : "Belum tersedia"]
    ]), ""] : []), "┌ <b>STATUS</b>",
    `└ <b>${escapeHtml(status)}</b>`, ...detail.split("\n").map((line) => `   ${escapeHtml(line)}`),
    ...(legacy ? ["Deteksi berasal dari rule lama; bukan kelulusan filter saat ini."]
      : event.kind === "candidate" ? []
      : event.kind === "spike" || event.kind === "volume" ? []
      : ["Kelipatan harga teramati saat query; bukan target atau ATH."]),
    ...(notes.length ? ["", "<b>Catatan Risiko</b>", ...notes] : []), "",
    ...(unavailable.length ? ["<b>Data Belum Tersedia</b>",
      ...unavailable.map(([, reason]) => escapeHtml(`Linked funding: ${clip(reason, 140)}`)), ""] : []),
    "<b>CA</b>", escapeHtml(r.mint)
  ].join("\n");
}

function age(minutes: number): string {
  return minutes >= 1440 ? `Umur ${number(minutes / 1440, 1)} hari`
    : minutes >= 60 ? `Umur ${number(minutes / 60, 1)} jam` : `${number(minutes)}m`;
}

function block(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return [`┌ <b>${title}</b>`, ...rows.map(([label, value], index) => {
    const prefix = `${index === rows.length - 1 ? "└" : "├"} ${label.padEnd(width)} :`;
    return `${prefix} <b>${escapeHtml(value)}</b>`;
  })].join("\n");
}
function present(value: number | null | undefined): value is number { return value != null && Number.isFinite(value); }
function number(value: number | null | undefined, digits = 2): string {
  return present(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "N/A";
}
function usd(value: number | null | undefined, compact = false): string {
  if (!present(value)) return "N/A";
  if (compact) {
    for (const [scale, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
      if (Math.abs(value) >= scale) return `$${number(value / scale)}${suffix}`;
    }
    return `$${number(value)}`;
  }
  if (value !== 0 && Math.abs(value) < 1e-20) return `$${value.toExponential(3)}`;
  const digits = value !== 0 && Math.abs(value) < 1 ? Math.min(20, Math.max(8, 3 - Math.floor(Math.log10(Math.abs(value))))) : 6;
  return `$${number(value, digits)}`;
}
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function clip(value: string, length: number): string { return Array.from(value.replace(/[\r\n\t]+/g, " ")).slice(0, length).join(""); }
