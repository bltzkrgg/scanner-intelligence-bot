import { Bot } from "grammy";
import { IntelligenceScanner } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig, logger } from "@sti/shared";
import { startCommand } from "./commands/start.js";
import { registerScanHandlers } from "./handlers/scan.js";
import { configureTelegramMenu, registerUtilityCommands, sendStartupNotification } from "./lifecycle.js";

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for telegram bot");
}

const bot = new Bot(config.telegramBotToken);
const scanner = new IntelligenceScanner(createGmgnAdapter(config.gmgnProvider));

bot.command("start", startCommand);
registerUtilityCommands(bot, config);
registerScanHandlers(bot, scanner);

bot.catch((error) => {
  logger.error({ error }, "Telegram bot error");
});

try {
  await configureTelegramMenu(bot);
} catch {
  logger.warn("Telegram menu setup failed; commands remain available by typing them");
}

await bot.start({
  onStart: async () => {
    logger.info("Telegram polling starting");
    try {
      await sendStartupNotification(bot, config);
    } catch {
      logger.warn("Startup notification failed; check TELEGRAM_STARTUP_CHAT_ID and bot send permissions");
    }
  }
});
