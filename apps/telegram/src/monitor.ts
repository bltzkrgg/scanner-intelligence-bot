import { Bot } from "grammy";
import { logger } from "@sti/shared";
import { HeartbeatMonitor, loadMonitorConfig, probeHeartbeat } from "./heartbeat-monitor.js";
import { sendStatusMessage } from "./lifecycle.js";

const config = loadMonitorConfig();
const bot = new Bot(config.botToken);
const monitor = new HeartbeatMonitor(config.stateFile, config.timeoutSec);
await monitor.init();
let stopping = false;
let wake: (() => void) | undefined;
const stop = () => { stopping = true; wake?.(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
logger.info("Independent bot heartbeat monitor started; no Telegram getUpdates polling");
try {
  while (!stopping) {
    let heartbeat: unknown;
    try { heartbeat = await probeHeartbeat(config); } catch { heartbeat = undefined; }
    if (stopping) break;
    try {
      await monitor.tick(heartbeat, async (text) => {
        await sendStatusMessage(bot, config.chatId, text);
      });
    } catch { logger.warn("Monitor state write or notification failed; check endpoint/auth, state permissions and Telegram destination"); }
    if (!stopping) await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { wake = undefined; resolve(); }, config.pollIntervalSec * 1000);
      wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
    });
  }
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
