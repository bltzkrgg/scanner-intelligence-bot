import type { Bot } from "grammy";
import type { AppConfig } from "@sti/shared";
import type { RunnerMonitor } from "@sti/analysis";

export function statusMessage(config: AppConfig, runner?: RunnerMonitor): string {
  return [
    "SOLANA TOKEN INTELLIGENCE",
    "Status: proses bot aktif",
    "Jaringan: Solana",
    config.gmgnProvider === "mock"
      ? "Mode data: MOCK / data contoh, bukan data pasar aktual."
      : "Mode data: GMGN CLI / koneksi provider belum diverifikasi oleh status ini.",
    "",
    "Kirim satu CA Solana langsung untuk meminta laporan.",
    "Menu: /start, /scan, /help, /status, /chatid, /runner, /runners.",
    `Runner: ${runner?.active ? "AKTIF" : "NONAKTIF"}. Interval: ${config.runnerIntervalSeconds} detik setelah siklus selesai.`,
    "Smart wallet bank sendiri, multichain, dan Discord belum aktif."
  ].join("\n");
}

export function registerUtilityCommands(bot: Bot, config: AppConfig, runner?: RunnerMonitor): void {
  bot.command("help", async (ctx) => {
    await ctx.reply("Kirim satu CA Solana atau /scan <CA>.\n/runner <CA>: evaluasi runner dan histori.\n/runners: daftar dan status pemantauan.\n/runner_on, /runner_off, /runner_remove <CA>: khusus admin.\n/status: mode data.\n/chatid: ID chat dan user untuk konfigurasi.");
  });
  bot.command("status", async (ctx) => { await ctx.reply(statusMessage(config, runner)); });
  bot.command("chatid", async (ctx) => { await ctx.reply(`Chat ID: ${ctx.chat.id}\nUser ID: ${ctx.from?.id ?? "tidak tersedia"}`); });
}

export async function configureTelegramMenu(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Mulai menggunakan bot" },
    { command: "scan", description: "Analisis CA Solana" },
    { command: "help", description: "Panduan penggunaan" },
    { command: "status", description: "Status bot dan mode data" },
    { command: "chatid", description: "ID chat dan user untuk konfigurasi" },
    { command: "runner", description: "Cek runner: /runner CA" },
    { command: "runners", description: "Daftar kandidat dan histori runner" },
    { command: "runner_on", description: "Admin: lanjutkan pemantauan runner" },
    { command: "runner_off", description: "Admin: jeda pemantauan runner" },
    { command: "runner_remove", description: "Admin: hapus histori satu CA" }
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

export async function sendStartupNotification(bot: Bot, config: AppConfig, runner?: RunnerMonitor): Promise<void> {
  if (!config.telegramStartupChatId) return;
  await bot.api.sendMessage(
    config.telegramStartupChatId,
    ["BOT MULAI BERJALAN", statusMessage(config, runner)].join("\n\n")
  );
}
