import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import { CHAIN_NAMES, isEnrichmentDiagnostic, type Chain, type IntelligenceResult } from "@sti/shared";
import { assessRunner, type RunnerEvent } from "@sti/analysis";

const text = (value: string, max = 180) => escapeMarkdown(value.replace(/[\r\n\t]/g, " ").slice(0, max)).slice(0, max);
const num = (n: number | null | undefined, digits = 2) => n == null || !Number.isFinite(n) ? "N/A"
  : Math.abs(n) >= 1e15 ? n.toExponential(3) : n.toLocaleString("en-US", { maximumFractionDigits: digits });
const usd = (n: number | null | undefined) => n == null ? "N/A" : `$${n > 0 && n < 1e-10 ? n.toExponential(3)
  : n >= 1000 ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }) : num(n, n < 1 ? 10 : 2)}`;
const pct = (n: number | null | undefined) => n == null ? "N/A" : `${num(n)}%`;
const wallets = (n: number | null | undefined) => n == null ? "N/A" : `${num(n, 0)} wallet`;

export function reportButtons(chain: Chain, mint: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`dc:scan:${chain}:${mint}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dc:risk:${chain}:${mint}`).setLabel("Detail Risiko").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dc:runner:${chain}:${mint}`).setLabel("Status Runner").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel("GMGN").setStyle(ButtonStyle.Link).setURL(`https://gmgn.ai/${chain}/token/${mint}`)
  );
}

export function chainButtons(mint: string, chains: Chain[]) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(chains.filter((chain) => chain !== "sol").map((chain) =>
    new ButtonBuilder().setCustomId(`dc:scan:${chain}:${mint}`).setLabel(CHAIN_NAMES[chain]).setStyle(ButtonStyle.Primary)));
}

export function discordReport(result: IntelligenceResult, detail = false): EmbedBuilder {
  const s = result.snapshot;
  if (s.source === "fixture") return new EmbedBuilder().setTitle("MODE DEMO / MOCK")
    .setDescription(`CA: \`${s.mint}\`\nSnapshot contoh tetap, bukan data token ini. Aktifkan GMGN_PROVIDER=cli untuk data nyata.`);
  const i = s.intelligence;
  const score = assessRunner(s);
  const embed = new EmbedBuilder().setColor(0x2caa7d).setTitle(text(`${s.symbol} | ${CHAIN_NAMES[s.chain ?? "sol"]}`, 240))
    .setDescription(`${text(s.name)}\nCA: \`${s.mint}\``)
    .addFields(
      { name: "MARKET", value: [`Harga: **${usd(s.priceUsd)}**`, `MC: ${usd(s.marketCapUsd)}`, `Likuiditas: ${usd(s.liquidityUsd)}`,
        `Volume 5m / 24j: ${usd(s.volume5mUsd)} / ${usd(s.volume24hUsd)}`, `Swaps 5m: ${num(s.swaps5m, 0)}`,
        `Fees: ${num(s.totalFeesNative, 8)} ${s.feesNativeSymbol ?? ""}`].join("\n") },
      { name: "ACTIVITY", value: [`Holder: ${num(s.holderCount, 0)}`, `Buy/Sell 1j: ${num(s.buys1h, 0)} / ${num(s.sells1h, 0)}`,
        `Perubahan 1j / 6j: ${pct(s.priceChange1hPct)} / ${pct(s.priceChange6hPct)}`, `Top 10: ${pct(s.top10HolderPct)}`].join("\n") },
      { name: "INTELLIGENCE", value: [`Smart Money: ${num(s.smartMoneyHolderCount, 0)}`, `KOL: ${num(i?.kolHolderCount, 0)}`,
        `Bundler: ${wallets(i?.bundlerWalletCount)}`, `Sniper: ${wallets(i?.sniperWalletCount)}`,
        `Bundler vol.: ${pct(i?.bundlerVolumePct)} volume`,
        `FOMO Top 100: ${i?.fomo ? `${i.fomo.matched} terdeteksi (${i.fomo.window}, parsial)` : "N/A"}`,
        s.chain === "robinhood" ? `Dev graduated: ${num(i?.developerGraduatedCount, 0)}` : `Dev bonded: ${num(i?.developerBondedCount, 0)}`].join("\n") },
      { name: "STATUS", value: `Runner Score: ${num(score.score, 0)}/100 (eksperimen)\n${score.candidate ? "Memenuhi rule skor" : "Belum memenuhi / data belum lengkap"}\nBenchmark historis: ${num(result.historicalScore, 0)}` }
    );
  if (detail) {
    const warnings = [...new Set([...(s.runnerBlockReason ? [s.runnerBlockReason] : []), ...result.warnings])]
      .filter((warning) => !isEnrichmentDiagnostic(warning)).slice(0, 5).map((warning) => text(warning, 140));
    embed.addFields({ name: "RISIKO", value: [`Insider: ${pct(s.insiderPct)}`, `Exposure supply bundler/sniper: ${pct(s.bundlerPct)} / ${pct(s.sniperPct)}`,
      `Linked funding teramati: ${pct(i?.linkedFundingPct)}`, ...warnings].join("\n").slice(0, 1024) });
  }
  return embed.setFooter({ text: "GMGN dan enrichment provider | Data kosong bukan bukti aman. Bukan rekomendasi beli/jual." })
    .setTimestamp(new Date(s.observedAt));
}

export function discordRunnerAlert(event: RunnerEvent): EmbedBuilder {
  const r = event.record;
  const delayed = Date.now() - Date.parse(r.lastSeenAt) > 15 * 60000;
  const warnings = r.riskNotes.filter((note) => !isEnrichmentDiagnostic(note)).slice(0, 3).map((note) => text(note, 180));
  return new EmbedBuilder().setColor(0x2caa7d).setTitle(`${CHAIN_NAMES[r.chain]} | TOKEN RUNNER`)
    .setDescription(`${text(r.symbol)} | ${text(r.name)}\nCA: \`${r.mint}\`${delayed ? "\n**ALERT TERTUNDA: data saat event, bukan harga terbaru.**" : ""}`)
    .addFields(
      { name: "MARKET", value: [`Harga: ${usd(r.latestPrice)}`, `MC: ${usd(r.marketCapUsd)}`, `Likuiditas: ${usd(r.liquidityUsd)}`,
        `Volume 5m: ${usd(r.volume5mUsd)}`, `Swaps 5m: ${num(r.swaps5m, 0)}`, `Fees: ${num(r.totalFeesNative, 8)} ${r.feesNativeSymbol ?? ""}`].join("\n") },
      { name: "INTELLIGENCE", value: [`Smart Money: ${num(r.smartMoneyHolderCount, 0)}`, `Bundler: ${wallets(r.intelligence?.bundlerWalletCount)}`,
        `Sniper: ${wallets(r.intelligence?.sniperWalletCount)}`, `Bundler vol.: ${pct(r.intelligence?.bundlerVolumePct)} volume`].join("\n") },
      { name: "STATUS", value: `${event.kind === "2x" || event.kind === "5x" ? `${event.kind.toUpperCase()} TERAMATI` : event.kind === "spike" ? "VOLUME SPIKE" : event.kind === "volume" ? "VOLUME TINGGI" : "KANDIDAT BARU"}\n${num(r.latestPrice / r.initialPrice)}x dari deteksi\nFilter momentum, bukan audit risiko atau jaminan profit.` },
      ...(warnings.length ? [{ name: "CATATAN RISIKO", value: warnings.join("\n") }] : [])
    ).setTimestamp(new Date(r.lastSeenAt));
}
