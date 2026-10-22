import { Client, Events, type MessageCreateOptions } from "discord.js";
import { RunnerMonitor } from "@sti/analysis";
import { logger, type AppConfig, type Chain } from "@sti/shared";
import { discordCommands } from "./commands.js";
import { discordRunnerAlert, reportButtons } from "./report.js";

export async function sendDiscordChannel(client: Client, channelId: string, guildId: string, payload: MessageCreateOptions): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("guildId" in channel) || channel.guildId !== guildId || !channel.isSendable()) {
    throw new Error("Tujuan Discord bukan channel yang dapat dikirim pada guild yang dikonfigurasi.");
  }
  await channel.send({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
}

export async function runDiscordRuntime(client: Client, runner: RunnerMonitor, config: AppConfig,
  options: { signals?: NodeJS.EventEmitter; onStopping?: () => void; drain?: () => Promise<void>;
    forceExit?: (code: number) => void } = {}): Promise<void> {
  const signals = options.signals ?? process;
  let stopping = false;
  let reason = "proses berakhir";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cycle: Promise<void> | undefined;
  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStop = resolve; });
  const counts: Partial<Record<Chain, number>> = {};
  const startedChains = new Set<Chain>();
  const notify = async (content: string) => {
    if (config.discordStartupChannelId) await sendDiscordChannel(client, config.discordStartupChannelId,
      config.discordGuildId!, { content });
  };
  const flush = async () => {
    if (!config.discordRunnerChannelId) return;
    await runner.deliverNotifications(async (event) => sendDiscordChannel(client, config.discordRunnerChannelId!, config.discordGuildId!, {
      embeds: [discordRunnerAlert(event)], components: [reportButtons(event.record.chain, event.record.mint)]
    }), config.enabledChains, counts);
  };
  async function tick() {
    if (stopping) return;
    cycle = (async () => {
      await flush();
      await runner.cycle({ scheduled: true, onChainStart: (chain) => {
        if (startedChains.has(chain)) counts[chain] = 0;
        startedChains.add(chain);
      }, onObservation: flush });
      await flush();
    })();
    try { await cycle; } catch { logger.warn("Discord runner cycle failed; check provider and state permissions"); }
    if (!stopping) timer = setTimeout(() => { void tick(); }, 1000);
  }
  function stop(message: string) {
    if (stopping) return;
    stopping = true; reason = message;
    options.onStopping?.(); runner.stop();
    if (timer) clearTimeout(timer);
    deadline = setTimeout(() => {
      logger.error("Discord shutdown deadline exceeded; notification/checkpoint not assumed successful");
      (options.forceExit ?? process.exit)(1);
    }, config.botShutdownTimeoutSec * 1000);
    deadline.unref(); resolveStop();
  }
  const int = () => stop("SIGINT");
  const term = () => stop("SIGTERM");
  const invalidated = () => { process.exitCode = 1; stop("sesi Gateway tidak valid"); };
  const clientError = () => { logger.warn("Discord client error; credentials omitted"); };
  signals.on("SIGINT", int); signals.on("SIGTERM", term);
  client.on(Events.Invalidated, invalidated); client.on(Events.Error, clientError);
  try {
    const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
    await client.login(config.discordBotToken);
    await ready;
    if (!stopping) {
      if (!client.application) throw new Error("Aplikasi Discord belum siap.");
      await client.application.commands.set(discordCommands, config.discordGuildId!);
      if (!stopping) {
        try { await notify(`TOKEN INTELLIGENCE | DISCORD ONLINE\nJaringan: ${config.enabledChains.join(" | ")}\nData: ${config.gmgnProvider}\nRunner: ${runner.active ? "Aktif" : "Nonaktif"}\nStatus proses aktif; koneksi provider belum diverifikasi sebelum query berhasil.`); }
        catch { logger.warn("Discord ONLINE notification failed; check startup channel/guild and permissions"); }
        if (config.runnerEnabled) void tick();
      }
    }
    await stopped;
  } catch {
    process.exitCode = 1; stop("startup atau Gateway gagal");
    logger.error("Discord runtime failed; check token, guild, intents and permissions; credentials omitted");
  } finally {
    stop(reason);
    let saved = false;
    try { await cycle?.catch(() => undefined); await options.drain?.(); await runner.checkpoint(); saved = true; }
    catch { logger.warn("Discord final runner checkpoint failed"); }
    try { if (client.isReady()) await notify(`TOKEN INTELLIGENCE | DISCORD OFFLINE\nProses dihentikan: ${reason}.\nScan dan alert Discord tidak tersedia selama proses berhenti.\nState terakhir: ${saved ? "berhasil disimpan" : "penyimpanan belum dikonfirmasi"}.`); }
    catch { logger.warn("Discord OFFLINE notification failed"); }
    await client.destroy();
    if (deadline) clearTimeout(deadline);
    signals.off("SIGINT", int); signals.off("SIGTERM", term);
    client.off(Events.Invalidated, invalidated); client.off(Events.Error, clientError);
  }
}
