import { resolve } from "node:path";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { IntelligenceScanner, RunnerMonitor } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig, logger } from "@sti/shared";
import { DiscordHandlers } from "./handlers.js";
import { runDiscordRuntime } from "./runtime.js";

const config = loadConfig();
if (!config.discordBotToken || !config.discordGuildId) throw new Error("DISCORD_BOT_TOKEN dan DISCORD_GUILD_ID wajib diisi.");
if (resolve(config.discordRunnerStateFile) === resolve(config.runnerStateFile)) {
  throw new Error("DISCORD_RUNNER_STATE_FILE tidak boleh sama dengan RUNNER_STATE_FILE Telegram.");
}
if (config.runnerEnabled && (config.gmgnProvider !== "cli" || !config.discordAdminIds.length || !config.discordRunnerChannelId)) {
  throw new Error("Runner Discord membutuhkan GMGN_PROVIDER=cli, DISCORD_ADMIN_IDS, dan DISCORD_RUNNER_CHANNEL_ID.");
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [], repliedUser: false } });
const adapter = createGmgnAdapter(config.gmgnProvider, config);
const scanner = new IntelligenceScanner(adapter, undefined, config.enabledChains);
const runner = new RunnerMonitor(adapter, config.discordRunnerStateFile, config.runnerEnabled, config.enabledChains);
await runner.init();
const handlers = new DiscordHandlers(scanner, runner, config);
let accepting = true;
const pending = new Set<Promise<void>>();
function dispatch(work: () => Promise<void>) {
  if (!accepting) return;
  const task = work().catch(() => { logger.warn("Discord handler failed; credentials omitted"); });
  pending.add(task); void task.finally(() => pending.delete(task));
}
client.on(Events.MessageCreate, (message) => dispatch(() => handlers.message(message)));
client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand() || interaction.isButton()) dispatch(async () => {
    try { await handlers.interaction(interaction); }
    catch {
      logger.warn("Discord interaction failed; credentials omitted");
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: "Permintaan gagal diproses. Coba lagi sebentar.", embeds: [], components: [] }).catch(() => undefined);
      else await interaction.reply({ content: "Permintaan gagal diproses.", flags: 64 }).catch(() => undefined);
    }
  });
});
await runDiscordRuntime(client, runner, config, { onStopping: () => { accepting = false; },
  drain: async () => { await Promise.allSettled([...pending]); } });
