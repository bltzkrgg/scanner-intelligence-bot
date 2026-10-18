import { createHash } from "node:crypto";
import { CHAIN_NAMES } from "@sti/shared";
import type { RunnerEvent } from "./runner.js";

export function formatRunnerNotification(event: RunnerEvent, now = Date.now()): string {
  const r = event.record;
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
    ["Fees", hasFees ? `${number(r.totalFeesNative, 8)} ${native}` : "N/A"],
    ["Liquidity", usd(r.liquidityUsd, true)]
  ]);
  const activity = block("ACTIVITY", [
    ["Buy/Sell 1h", present(r.buys1h) && present(r.sells1h) ? `${number(r.buys1h, 0)} / ${number(r.sells1h, 0)}` : "N/A"],
    ["Top 10", present(r.top10HolderPct) ? `${number(r.top10HolderPct)}%` : "N/A"],
    ["Smart Money", number(r.smartMoneyHolderCount, 0)]
  ]);
  let status: string;
  let detail: string;
  if (event.kind === "2x" || event.kind === "5x") {
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
    detail = complete ? r.chain === "robinhood" ? "VOL 5m • FEES" : "VOL 5m • MC • FEES • AGE"
      : "Data wajib N/A.\nFilter belum terverifikasi.";
  }
  const notes = r.riskNotes.slice(0, 3).map((note) => escapeHtml(clip(note, 180)));
  const ref = createHash("sha256").update(event.id).digest("hex").slice(0, 12);
  return [
    `<b>${badge} ${network} TOKEN RUNNER</b>`, "",
    `<b>${escapeHtml(clip(r.symbol, 40))}</b>${present(r.dexAgeMinutes) ? ` · ${number(r.dexAgeMinutes)}m DEX` : ""}`,
    escapeHtml(`${CHAIN_NAMES[r.chain]} | GMGN`), "",
    ...(delayed ? ["<b>⚠️ ALERT TERTUNDA</b>", "Data saat event, bukan harga terbaru.", ""] : []),
    `<pre>${escapeHtml(`${market}\n\n${activity}\n\n┌ STATUS\n└ ${status}\n${wrapLines(detail, 28).map((line) => `  ${line}`).join("\n")}`)}</pre>`, "",
    ...(legacy ? ["Deteksi berasal dari rule lama; bukan kelulusan filter saat ini."]
      : event.kind === "candidate" ? ["Hasil filter alert admin saat deteksi, bukan status terkini."]
      : event.kind === "spike" ? []
      : ["Kelipatan harga teramati saat query; bukan target atau ATH."]),
    ...(notes.length ? ["", "<b>Catatan Risiko</b>", ...notes] : []), "",
    "<b>CA</b>", `<code>${escapeHtml(r.mint)}</code>`, "",
    `<i>Data event: ${escapeHtml(wib(r.lastSeenAt))}</i>`, `<i>Ref: ${ref}</i>`,
    "<i>N/A = belum tersedia. Smart Money adalah label provider.</i>",
    "<i>Filter momentum bukan audit risiko. Bukan rekomendasi beli/jual.</i>"
  ].join("\n");
}

function block(title: string, rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return [`┌ ${title}`, ...rows.map(([label, value], index) => {
    const prefix = `${index === rows.length - 1 ? "└" : "├"} ${label.padEnd(width)} :`;
    return prefix.length + value.length + 1 <= 30 ? `${prefix} ${value}`
      : `${prefix}\n${wrapLines(value, 28).map((line) => `  ${line}`).join("\n")}`;
  })].join("\n");
}
function wrapLines(text: string, width: number): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + word.length + 1 > width) { lines.push(line); line = ""; }
      line += `${line ? " " : ""}${word}`;
    }
    if (line) lines.push(line);
    return lines;
  });
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
function wib(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso)) + " WIB";
}
