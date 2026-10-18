import type { Bot } from "grammy";
import type { RunnerMonitor } from "@sti/analysis";
import { logger, type AppConfig } from "@sti/shared";
import { BotHealth, startHealthServer } from "./health.js";
import { configureTelegramMenu, sendRunnerNotifications, sendStartupNotification, sendShutdownNotification } from "./lifecycle.js";

export async function runTelegramRuntime(bot: Bot, runner: RunnerMonitor, config: AppConfig,
  options: { signals?: NodeJS.EventEmitter; forceExit?: (code: number) => void } = {}): Promise<void> {
  const signals = options.signals ?? process;
  const forceExit = options.forceExit ?? ((code) => process.exit(code));
  const startedAt = Date.now();
  const health = new BotHealth(startedAt);
  let stopping = false;
  let reason = "proses berakhir";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cycle: Promise<void> | undefined;
  let stopPolling: Promise<void> | undefined;
  let closeHealth: (() => Promise<void>) | undefined;

  bot.api.config.use(async (previous, method, payload, signal) => {
    const result = await previous(method, payload, signal);
    if (method === "getUpdates" && result.ok) health.pollSucceeded();
    return result;
  });

  async function tick(): Promise<void> {
    if (stopping) return;
    cycle = runner.cycle({ scheduled: true }).then((chains) => sendRunnerNotifications(bot, runner, config, chains));
    try { await cycle; } catch { logger.warn("Runner cycle or state write failed"); }
    if (!stopping) timer = setTimeout(() => { void tick(); }, 1000);
  }

  function requestStop(nextReason: string): void {
    if (stopping) return;
    stopping = true;
    reason = nextReason;
    health.stopping();
    runner.stop();
    if (timer) clearTimeout(timer);
    deadline = setTimeout(() => {
      logger.error("Shutdown deadline exceeded; no successful checkpoint or notification is assumed");
      forceExit(1);
    }, config.botShutdownTimeoutSec * 1000);
    deadline.unref();
    if (bot.isRunning()) stopPolling = bot.stop().catch(() => { logger.warn("Telegram polling stop failed"); });
  }
  const onInt = () => requestStop("menerima sinyal SIGINT");
  const onTerm = () => requestStop("menerima sinyal SIGTERM");
  signals.on("SIGINT", onInt);
  signals.on("SIGTERM", onTerm);
  try {
    closeHealth = await startHealthServer(health, config);
    if (!stopping) {
      try { await configureTelegramMenu(bot); }
      catch { logger.warn("Telegram menu setup failed; commands remain available by typing them"); }
    }
    if (!stopping) await bot.start({ onStart: async () => {
      if (stopping) return;
      health.ready();
      logger.info("Telegram polling starting");
      try { await sendStartupNotification(bot, config, runner); }
      catch { logger.warn("ONLINE notification failed; check TELEGRAM_STARTUP_CHAT_ID and send permissions"); }
      if (config.runnerEnabled && !stopping) void tick();
    } });
  } catch {
    process.exitCode = 1;
    requestStop("startup atau polling Telegram gagal; periksa log/service");
    logger.error("Telegram runtime failed; provider credentials are omitted");
  } finally {
    requestStop(reason);
    let saved = false;
    try {
      // bot.start resolves only after the current middleware has finished.
      await stopPolling;
      await cycle?.catch(() => { logger.warn("Last runner cycle failed; final checkpoint will still be attempted"); });
      await runner.checkpoint();
      saved = true;
    } catch { logger.warn("Final runner checkpoint failed"); }
    try { await sendShutdownNotification(bot, config, reason, startedAt, saved); }
    catch { logger.warn("OFFLINE notification failed; external heartbeat monitoring is needed for abrupt failures"); }
    try { await closeHealth?.(); }
    finally {
      if (deadline) clearTimeout(deadline);
      signals.off("SIGINT", onInt);
      signals.off("SIGTERM", onTerm);
    }
  }
}
