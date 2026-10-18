const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parseEnv } = require("node:util");

const envFile = join(__dirname, ".env");
const env = parseEnv(readFileSync(envFile, "utf8"));
const shutdownSeconds = Number(env.BOT_SHUTDOWN_TIMEOUT_SEC || 25);

module.exports = {
  apps: [{
    name: "scanner-telegram",
    cwd: __dirname,
    script: join(__dirname, "apps/telegram/src/bot.ts"),
    interpreter: process.execPath,
    node_args: ["--env-file=" + envFile, "--import", "tsx"],
    exec_mode: "fork",
    instances: 1,
    kill_timeout: Number.isFinite(shutdownSeconds) ? Math.max(30000, (shutdownSeconds + 5) * 1000) : 30000,
    env: { ...env, TELEGRAM_STARTUP_CHAT_ID: env.TELEGRAM_STARTUP_CHAT_ID ?? "" }
  }]
};
