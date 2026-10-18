import { Bot } from "grammy";
import { IntelligenceScanner, RunnerMonitor } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig, logger } from "@sti/shared";
import { startCommand } from "./commands/start.js";
import { registerScanHandlers } from "./handlers/scan.js";
import { configureTelegramMenu, registerUtilityCommands, sendStartupNotification, sendRunnerNotifications } from "./lifecycle.js";
import { registerRunnerCommands } from "./handlers/runner.js";

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
registerScanHandlers(bot, scanner, runner);

bot.catch((error) => {
  logger.error({ error }, "Telegram bot error");
});

try {
  await configureTelegramMenu(bot);
} catch {
  logger.warn("Telegram menu setup failed; commands remain available by typing them");
}

let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let cycle: Promise<void> | undefined;
async function tick(): Promise<void> {
  if (stopping) return;
  cycle = runner.cycle().then(() => sendRunnerNotifications(bot, runner, config));
  try { await cycle; } catch { logger.warn("Runner cycle or state write failed"); }
  if (!stopping) timer = setTimeout(() => { void tick(); }, config.runnerIntervalSeconds * 1000);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    runner.stop();
    if (timer) clearTimeout(timer);
    if (bot.isRunning()) void bot.stop();
  });
}

await bot.start({
  onStart: async () => {
    logger.info("Telegram polling starting");
    try {
      await sendStartupNotification(bot, config, runner);
    } catch {
      logger.warn("Startup notification failed; check TELEGRAM_STARTUP_CHAT_ID and bot send permissions");
    }
    if (config.runnerEnabled && !stopping) void tick();
  }
});
await cycle;
