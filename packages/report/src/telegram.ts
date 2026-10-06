import type { IntelligenceResult, MetricScore } from "@sti/shared";

export function formatTelegramReport(result: IntelligenceResult): string {
  const { snapshot } = result;
  const lines = [
    `*SOLANA TOKEN INTELLIGENCE*`,
    ``,
    `*${escapeMarkdown(snapshot.symbol)}* \\- ${escapeMarkdown(snapshot.name)}`,
    `CA: \`${snapshot.mint}\``,
    ``,
    `Klasifikasi: *${result.classification}*`,
    `Skor historis: *${result.historicalScore}/100*`,
    `Dibanding cohort: ${result.cohortSize} token`,
    escapeMarkdown(`Sumber data: ${snapshot.source}`),
    similarSummary(result),
    ``,
    `*Sinyal utama*`,
    ...topMetrics(result.metrics).map(formatMetric),
    ``,
    `*Catatan risiko*`,
    ...(result.warnings.length > 0 ? result.warnings.map((warning) => escapeMarkdown(`- ${warning}`)) : [escapeMarkdown("- Tidak ada warning besar dari rule MVP.")]),
    ``,
    `_${escapeMarkdown("Bukan sinyal beli/jual. Laporan ini hanya membandingkan setup token dengan data historis yang tersimpan.")}_`
  ];

  return lines.join("\n");
}

function similarSummary(result: IntelligenceResult): string {
  if (result.similarWinRatePct === null || result.similarMedianReturn24hPct === null) {
    return escapeMarkdown("Token mirip: belum cukup data historis.");
  }

  return escapeMarkdown(`Token mirip: ${result.similarWinRatePct}% berakhir positif 24j, median return ${result.similarMedianReturn24hPct}%.`);
}

function topMetrics(metrics: MetricScore[]): MetricScore[] {
  return [...metrics].sort((left, right) => right.weight - left.weight).slice(0, 6);
}

function formatMetric(metric: MetricScore): string {
  return escapeMarkdown(`- ${metric.name}: p${metric.percentile} (${formatValue(metric.value)})`);
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}
