import type { Bot } from "grammy";
import type { AppConfig } from "@sti/shared";

export function statusMessage(config: AppConfig): string {
  return [
    "SOLANA TOKEN INTELLIGENCE",
    "Status: proses bot aktif",
    "Jaringan: Solana",
    config.gmgnProvider === "mock"
      ? "Mode data: MOCK / data contoh, bukan data pasar aktual."
      : "Mode data: GMGN CLI / koneksi provider belum diverifikasi oleh status ini.",
    "",
    "Kirim satu CA Solana langsung untuk meminta laporan.",
    "Menu: /start, /scan, /help, /status, /chatid.",
    "Smart wallet bank, token runner, multichain, dan Discord belum aktif."
  ].join("\n");
}

export function registerUtilityCommands(bot: Bot, config: AppConfig): void {
  bot.command("help", async (ctx) => {
    await ctx.reply("Kirim satu CA Solana tanpa teks tambahan, atau /scan <CA>.\n/status untuk status proses dan mode data.\n/chatid untuk ID chat tujuan notifikasi startup.");
  });
  bot.command("status", async (ctx) => { await ctx.reply(statusMessage(config)); });
  bot.command("chatid", async (ctx) => { await ctx.reply(`Chat ID: ${ctx.chat.id}`); });
}

export async function configureTelegramMenu(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Mulai menggunakan bot" },
    { command: "scan", description: "Analisis CA Solana" },
    { command: "help", description: "Panduan penggunaan" },
    { command: "status", description: "Status bot dan mode data" },
    { command: "chatid", description: "ID chat untuk notifikasi startup" }
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

export async function sendStartupNotification(bot: Bot, config: AppConfig): Promise<void> {
  if (!config.telegramStartupChatId) return;
  await bot.api.sendMessage(
    config.telegramStartupChatId,
    ["BOT MULAI BERJALAN", statusMessage(config)].join("\n\n")
  );
}
