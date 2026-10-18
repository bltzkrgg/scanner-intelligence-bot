import type { Bot, Context } from "grammy";
import { assessRunner, formatRunnerRecord, type IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import { CHAIN_NAMES, parseTokenInput, type AppConfig } from "@sti/shared";
import { resolveTokenInput } from "./token-input.js";

export function registerRunnerCommands(bot: Bot, monitor: RunnerMonitor, scanner: IntelligenceScanner, config: AppConfig): void {
  bot.command("runners", async (ctx) => {
    const page = ctx.match.trim() ? Number(ctx.match.trim()) : 1;
    if (!Number.isInteger(page) || page < 1) { await ctx.reply("Gunakan /runners atau /runners <nomor_halaman>."); return; }
    const state = monitor.snapshot();
    const records = [...state.records].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    await ctx.reply([
      `TOKEN RUNNER | ${monitor.active ? "AKTIF" : "NONAKTIF"}`,
      `Jaringan: ${monitor.chains.map((chain) => CHAIN_NAMES[chain]).join(", ")}`,
      `Siklus selesai terakhir: ${state.lastCycleAt ?? "belum ada"}`,
      state.lastError ?? "",
      `Notifikasi: ${config.telegramRunnerChatId ? "tujuan dikonfigurasi" : "isi TELEGRAM_RUNNER_CHAT_ID"}; antrean ${state.pendingAlerts.length}.`,
      state.lastNotificationError ?? "",
      `Tersimpan: ${records.length} (maksimal 50 per jaringan). Data provider, bukan bank wallet sendiri.`,
      `Halaman ${page}/${Math.max(1, Math.ceil(records.length / 4))}; berikutnya: /runners ${page + 1}`,
      ...records.slice((page - 1) * 4, page * 4).map((entry) => formatRunnerRecord(entry)),
      records.length ? "Detail: /runner <CA>. Daftar ini bukan rekomendasi beli." : "Belum ada kandidat. Gunakan /runner <CA> atau tunggu siklus discovery."
    ].filter(Boolean).join("\n\n").slice(0, 4000));
  });

  bot.command("runner", async (ctx) => {
    await runnerInput(ctx, ctx.match.trim(), monitor, scanner);
  });
  bot.callbackQuery(/^runner:(sol|bsc|robinhood):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await runnerInput(ctx, `${ctx.match[1]} ${ctx.match[2]}`, monitor, scanner);
  });

  for (const command of ["runner_on", "runner_off", "runner_remove", "runner_test"] as const) {
    bot.command(command, async (ctx) => {
      if (!ctx.from || !config.telegramAdminIds.includes(String(ctx.from.id))) {
        await ctx.reply("Perintah ini khusus user ID yang terdaftar pada TELEGRAM_ADMIN_IDS.");
        return;
      }
      try {
        if (command === "runner_test") {
          if (!config.telegramRunnerChatId) { await ctx.reply("Isi TELEGRAM_RUNNER_CHAT_ID pada .env lalu restart bot."); return; }
          await bot.api.sendMessage(config.telegramRunnerChatId, [
            "TES NOTIFIKASI TOKEN RUNNER",
            `Jaringan: ${config.enabledChains.map((chain) => CHAIN_NAMES[chain]).join(", ")}`,
            "Pengiriman ke chat tujuan berhasil. Ini pesan uji, bukan deteksi kandidat atau sinyal beli."
          ].join("\n"));
          await ctx.reply("Pesan uji dikirim ke tujuan notifikasi runner.");
        } else if (command === "runner_remove") {
          const input = parseTokenInput(ctx.match.trim());
          if (!input?.chain) { await ctx.reply("Gunakan /runner_remove <sol|bsc|rh> <CA>."); return; }
          await monitor.remove(input.mint, input.chain);
          await ctx.reply("CA dan alert tertundanya dihapus dari histori jaringan tersebut. Discovery berikutnya dapat mendeteksinya lagi.");
        } else {
          await monitor.pause(command === "runner_off");
          await ctx.reply(command === "runner_on" ? "Runner aktif. Siklus berikutnya akan mengambil data live." : "Runner dijeda. Histori dan alert tertunda tetap tersimpan.");
        }
      } catch {
        await ctx.reply("Periksa konfigurasi runner, CA, izin file, serta chat ID/izin kirim Telegram. Restart setelah mengubah .env.");
      }
    });
  }
}

async function runnerInput(ctx: Context, text: string, monitor: RunnerMonitor, scanner: IntelligenceScanner): Promise<void> {
    const input = await resolveTokenInput(ctx, text, "runner", scanner.chains);
    if (!input) return;
    try {
      const { snapshot } = await scanner.scan(input.mint, input.chain);
      const assessment = assessRunner(snapshot);
      await monitor.observe(snapshot);
      const tracked = monitor.snapshot().records.find((entry) => entry.mint === snapshot.mint && entry.chain === input.chain);
      await ctx.reply([
        `${snapshot.symbol} | ${CHAIN_NAMES[input.chain]} | ${snapshot.mint}`,
        `Runner Score: ${assessment.score ?? "belum tersedia"}`,
        `Status saat query: ${assessment.candidate ? "KANDIDAT" : "BELUM MEMENUHI / DATA BELUM LENGKAP"}`,
        ...assessment.reasons,
        tracked ? formatRunnerRecord(tracked) : "Belum masuk histori deteksi.",
        monitor.active ? "Pemantauan aktif." : "Pemantauan nonaktif. Admin perlu mengaktifkan runner.",
        "Runner Score adalah rule eksperimen, bukan prediksi return."
      ].join("\n"));
    } catch { await ctx.reply("Runner gagal mengambil data. Periksa CA, GMGN, dan izin file state; tidak memakai data contoh sebagai fallback."); }
}
