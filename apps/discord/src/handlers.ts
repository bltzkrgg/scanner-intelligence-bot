import { EmbedBuilder, MessageFlags, type Message, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { IntelligenceScanner, RunnerMonitor, formatRunnerRecord } from "@sti/analysis";
import { parseTokenInput, type AppConfig } from "@sti/shared";
import { chainButtons, discordReport, reportButtons } from "./report.js";

type Interaction = ButtonInteraction | ChatInputCommandInteraction;
const adminCommands = new Set(["setconfig", "getconfig", "runner_on", "runner_off", "runner_remove"]);

export class DiscordHandlers {
  private scans = new Set<string>();
  private scannedAt = new Map<string, number>();

  constructor(private readonly scanner: IntelligenceScanner, private readonly runner: RunnerMonitor,
    private readonly config: AppConfig) {}

  allowed(guildId: string | null, channelId: string): boolean {
    return !!guildId && guildId === this.config.discordGuildId
      && (!this.config.discordChannelIds.length || this.config.discordChannelIds.includes(channelId));
  }

  async message(message: Message): Promise<void> {
    if (message.author.bot || message.webhookId || !this.allowed(message.guildId, message.channelId)) return;
    const input = message.content.trim().replace(/^!scan\s+/i, "");
    if (!parseTokenInput(input)) return;
    const payload = await this.scan(input, "scan", message.author.id);
    await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
  }

  async interaction(interaction: Interaction): Promise<void> {
    if (!this.allowed(interaction.guildId, interaction.channelId ?? "")) {
      await interaction.reply({ content: "Bot tidak diaktifkan di server/channel ini.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isButton()) {
      const match = /^dc:(scan|risk|runner):(sol|bsc|robinhood):([^:]+)$/.exec(interaction.customId);
      if (!match) return;
      await interaction.deferReply();
      await interaction.editReply({ ...await this.scan(`${match[2]} ${match[3]}`, match[1], interaction.user.id), allowedMentions: { parse: [] } });
      return;
    }
    const name = interaction.commandName;
    if (adminCommands.has(name) && !this.config.discordAdminIds.includes(interaction.user.id)) {
      await interaction.reply({ content: "Perintah ini khusus DISCORD_ADMIN_IDS.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply(adminCommands.has(name) ? { flags: MessageFlags.Ephemeral } : {});
    if (name === "scan" || name === "runner") {
      const ca = interaction.options.getString("ca", true);
      const chain = interaction.options.getString("chain");
      await interaction.editReply({ ...await this.scan(`${chain ? `${chain} ` : ""}${ca}`, name, interaction.user.id), allowedMentions: { parse: [] } });
      return;
    }
    let content: string;
    const state = this.runner.snapshot();
    if (name === "status") {
      content = `TOKEN INTELLIGENCE | Discord ONLINE\nData: ${this.config.gmgnProvider}\nJaringan: ${this.scanner.chains.join(" | ")}\nRunner: ${this.runner.active ? "Aktif" : "Nonaktif/jeda"}\nTerpantau: ${state.records.length}\nAntrean alert: ${state.pendingAlerts.length}\nTujuan runner: ${this.config.discordRunnerChannelId ? "dikonfigurasi" : "belum diisi"}\nTerakhir polling: ${state.lastCycleAt ?? "belum"}`;
    } else if (name === "runners") {
      const pages = Math.max(1, Math.ceil(state.records.length / 10));
      const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
      content = `RUNNERS | ${page}/${pages}\n` + (state.records.slice((page - 1) * 10, page * 10)
        .map((r) => `${r.chain} | ${r.mint}\n${(r.latestPrice / r.initialPrice).toFixed(2)}x dari deteksi`).join("\n\n") || "Belum ada token terpantau.");
    } else if (name === "getconfig") {
      const section = interaction.options.getString("section");
      const value = section && Object.hasOwn(state.alertConfig, section)
        ? state.alertConfig[section as keyof typeof state.alertConfig] : state.alertConfig;
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Filter Runner Discord")
        .setDescription(`\`\`\`json\n${JSON.stringify(value, null, 2).slice(0, 3900)}\n\`\`\``)] });
      return;
    } else if (name === "setconfig") {
      try {
        const changed = await this.runner.setConfig(interaction.options.getString("key", true), interaction.options.getString("value", true));
        content = `${changed.key} = ${JSON.stringify(changed.value)}`;
      } catch { content = "Konfigurasi tidak valid atau gagal disimpan. Periksa key, batas nilai, dan izin file state."; }
    } else if (name === "runner_on" || name === "runner_off") {
      try { await this.runner.pause(name === "runner_off"); content = `Runner ${this.runner.active ? "aktif" : "dijeda"}.`; }
      catch { content = "Runner belum diaktifkan lewat RUNNER_ENABLED atau state gagal disimpan."; }
    } else if (name === "runner_remove") {
      const chain = interaction.options.getString("chain");
      const input = parseTokenInput(`${chain ? `${chain} ` : ""}${interaction.options.getString("ca", true)}`);
      if (!input?.chain || !this.scanner.chains.includes(input.chain)) content = "CA/chain tidak valid. Pilih chain secara eksplisit untuk EVM.";
      else {
        try { await this.runner.remove(input.mint, input.chain); content = "Token dihapus dari histori pemantauan Discord."; }
        catch { content = "Histori gagal disimpan; penghapusan belum dikonfirmasi."; }
      }
    } else content = "Perintah tidak dikenal.";
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  }

  private async scan(text: string, view: string, user: string) {
    const input = parseTokenInput(text);
    if (!input) return { content: "CA tidak valid." };
    if (!input.chain) {
      const chains = this.scanner.chains.filter((chain) => chain !== "sol");
      return chains.length ? { content: "Alamat EVM: pilih jaringan.", components: [chainButtons(input.mint, chains)] }
        : { content: "Jaringan EVM belum diaktifkan." };
    }
    if (!this.scanner.chains.includes(input.chain)) return { content: "Jaringan belum diaktifkan." };
    if (view === "runner") {
      const r = this.runner.snapshot().records.find((r) => r.chain === input.chain && r.mint === input.mint);
      return { content: r ? formatRunnerRecord(r).slice(0, 1900) : "Token belum masuk histori runner Discord." };
    }
    if (this.scans.has(user) || this.scans.size >= 3 || Date.now() - (this.scannedAt.get(user) ?? 0) < 10000) {
      return { content: "Scan masih berjalan atau cooldown 10 detik. Coba lagi sebentar." };
    }
    if (this.scannedAt.size >= 1000) this.scannedAt.delete(this.scannedAt.keys().next().value!);
    this.scans.add(user); this.scannedAt.set(user, Date.now());
    try {
      const result = await this.scanner.scan(input.mint, input.chain, view === "scan" ? { forceRefresh: true } : undefined);
      let saved = true;
      try { await this.runner.observe(result.snapshot); } catch { saved = false; }
      return { embeds: [discordReport(result, view === "risk")],
        components: result.snapshot.source === "fixture" ? [] : [reportButtons(input.chain, input.mint)],
        ...(!saved ? { content: "Laporan tersedia, tetapi histori runner gagal disimpan." } : {}) };
    } catch { return { content: "Scan gagal. Periksa CA, akses provider, kuota, dan log service. Tidak memakai data contoh sebagai fallback." }; }
    finally { this.scans.delete(user); }
  }
}
