import { Bot } from "grammy";
import { ZodError } from "zod";
import { loadConfig } from "@sti/shared";
import { notificationErrorMessage, sendLifecycleTest } from "./lifecycle.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.telegramBotToken) {
    console.error("TELEGRAM_BOT_TOKEN belum diisi pada environment proses ini.");
    process.exitCode = 1;
    return;
  }
  if (!config.telegramStartupChatId) {
    console.error("TELEGRAM_STARTUP_CHAT_ID kosong. Isi chat ID dari /chatid; jangan isi token atau username pada field chat ID.");
    process.exitCode = 1;
    return;
  }
  const bot = new Bot(config.telegramBotToken, { client: { timeoutSeconds: 10 } });
  const me = await bot.api.getMe();
  console.log(`Token terverifikasi untuk @${me.username ?? me.id}.`);
  const chat = await bot.api.getChat(config.telegramStartupChatId);
  console.log(`Chat tujuan ditemukan: ${chat.id} (${chat.type}).`);
  await sendLifecycleTest(bot, config);
  console.log("TES notifikasi terkirim. Jika CLI berhasil tetapi startup PM2 gagal, bandingkan bot, cwd, script dan environment proses PM2. CLI ini tidak menjalankan getUpdates.");
}

try { await main(); }
catch (error) {
  console.error(error instanceof ZodError ? `Konfigurasi .env tidak valid pada field: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}` : notificationErrorMessage(error));
  console.error("Pastikan .env valid, chat tujuan benar, dan bot memiliki izin kirim. Jangan membagikan token/API key.");
  process.exitCode = 1;
}
