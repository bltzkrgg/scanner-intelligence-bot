import { Bot } from "grammy";
import { IntelligenceScanner, RunnerMonitor } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig, logger } from "@sti/shared";
import { startCommand } from "./commands/start.js";
import { registerScanHandlers } from "./handlers/scan.js";
import { registerUtilityCommands } from "./lifecycle.js";
import { registerRunnerCommands } from "./handlers/runner.js";
import { registerConfigCommands } from "./handlers/config.js";
import { runTelegramRuntime } from "./runtime.js";

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for telegram bot");
}

const bot = new Bot(config.telegramBotToken);
if (config.runnerEnabled && config.gmgnProvider !== "cli") {
  throw new Error("RUNNER_ENABLED=true requires GMGN_PROVIDER=cli; runner cannot use fixture data");
}
if (config.runnerEnabled && config.telegramAdminIds.length === 0) {
  throw new Error("RUNNER_ENABLED=true requires TELEGRAM_ADMIN_IDS");
}
const adapter = createGmgnAdapter(config.gmgnProvider);
const scanner = new IntelligenceScanner(adapter, undefined, config.enabledChains);
const runner = new RunnerMonitor(adapter, config.runnerStateFile, config.runnerEnabled, config.enabledChains);
await runner.init();

bot.command("start", startCommand);
registerUtilityCommands(bot, config, runner);
registerRunnerCommands(bot, runner, scanner, config);
registerConfigCommands(bot, runner, config);
registerScanHandlers(bot, scanner, runner);

bot.catch((error) => {
  logger.error({ error }, "Telegram bot error");
});

await runTelegramRuntime(bot, runner, config);
