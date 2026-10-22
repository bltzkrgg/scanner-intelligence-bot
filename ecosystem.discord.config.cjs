const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parseEnv } = require("node:util");

const envFile = join(__dirname, ".env");
const env = parseEnv(readFileSync(envFile, "utf8"));
const seconds = Number(env.BOT_SHUTDOWN_TIMEOUT_SEC || 25);
module.exports = { apps: [{
  name: "scanner-discord",
  cwd: __dirname,
  script: join(__dirname, "apps/discord/src/bot.ts"),
  interpreter: process.execPath,
  node_args: ["--env-file=" + envFile, "--import", "tsx"],
  exec_mode: "fork",
  instances: 1,
  kill_timeout: Number.isFinite(seconds) ? Math.max(30000, (seconds + 5) * 1000) : 30000,
  env
}] };
