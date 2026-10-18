import { CHAIN_NAMES, type IntelligenceResult } from "@sti/shared";
import { assessRunner } from "@sti/analysis";

export function formatTelegramReport(result: IntelligenceResult): string {
  const s = result.snapshot;
  if (s.source === "fixture") {
    return [
      "*MODE DEMO / MOCK*",
      escapeMarkdown(`CA input: ${s.mint}`),
      escapeMarkdown("Ini snapshot contoh yang tetap, bukan data token pada CA tersebut."),
      escapeMarkdown("Skor, klasifikasi, win rate, dan runner tidak dihitung dari fixture."),
      escapeMarkdown("Admin: pasang gmgn-cli, isi GMGN_API_KEY, ubah GMGN_PROVIDER=cli, lalu restart bot.")
    ].join("\n\n");
  }
  const runner = assessRunner(s);
  const lines = [
    "TOKEN INTELLIGENCE",
    `Jaringan: ${CHAIN_NAMES[s.chain ?? "sol"]}`,
    `${s.symbol} - ${s.name}`,
    `CA: ${s.mint}`,
    `Sumber data: ${s.source}; waktu: ${s.observedAt}`,
    "",
    `Harga USD: ${value(s.priceUsd, 10)}`,
    `Market cap USD (harga x circulating supply): ${value(s.marketCapUsd)}`,
    `Likuiditas USD: ${value(s.liquidityUsd)}`,
    `Volume 24j USD: ${value(s.volume24hUsd)}`,
    `Umur (menit): ${value(s.ageMinutes)}`,
    `Holder: ${value(s.holderCount)}`,
    `Beli/jual 1j: ${value(s.buys1h)} / ${value(s.sells1h)}`,
    `Perubahan 1j / 6j (%): ${value(s.priceChange1hPct)} / ${value(s.priceChange6hPct)}`,
    `Top 10 holder (%): ${value(s.top10HolderPct)}`,
    `Insider holdings (%): ${value(s.insiderPct)}`,
    `Bundler / sniper exposure (%): ${value(s.bundlerPct)} / ${value(s.sniperPct)}`,
    `Token diluncurkan developer: ${value(s.developerTokenCount)}`,
    `Developer rug rate (%): ${value(s.developerRugRatePct)}`,
    `Smart money holder (label provider): ${value(s.smartMoneyHolderCount)}`,
    `Smart money net flow 1j USD: ${value(s.smartMoneyNetFlowUsd1h)}`,
    `Likuiditas terkunci (%): ${value(s.liquidityLockedPct)}`,
    "",
    result.historicalScore === null
      ? "Skor historis / klasifikasi / win rate: belum tersedia. Benchmark riil belum terpasang."
      : `Skor historis: ${result.historicalScore}/100; klasifikasi: ${result.classification}; cohort: ${result.cohortSize}`,
    "",
    `Runner Score: ${runner.score ?? "belum tersedia"}${runner.score === null ? "" : "/100"}`,
    `Runner: ${runner.candidate ? "KANDIDAT" : "BELUM MEMENUHI / DATA BELUM LENGKAP"}`,
    ...runner.reasons,
    "Histori pemantauan: /runner <CA>; daftar: /runners.",
    "",
    "Catatan risiko:",
    ...result.warnings,
    "Bukan sinyal beli/jual. Skor runner belum dikalibrasi dengan backtest pasar."
  ];
  return lines.map(escapeMarkdown).join("\n");
}

function value(input: number | null | undefined, digits = 2): string {
  return input == null ? "belum tersedia" : input.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
