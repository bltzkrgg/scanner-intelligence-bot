import { Bot } from "grammy";
import { IntelligenceScanner } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig, logger } from "@sti/shared";
import { startCommand } from "./commands/start.js";
import { registerScanHandlers } from "./handlers/scan.js";

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for telegram bot");
}

const bot = new Bot(config.telegramBotToken);
const scanner = new IntelligenceScanner(createGmgnAdapter(config.gmgnProvider));

bot.command("start", startCommand);
registerScanHandlers(bot, scanner);

bot.catch((error) => {
  logger.error({ error }, "Telegram bot error");
});

await bot.start();
