import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Events, MessageFlags, type Client, type Message, type ChatInputCommandInteraction, type ButtonInteraction } from "discord.js";
import { loadConfig } from "@sti/shared";
import { IntelligenceScanner, RunnerMonitor } from "@sti/analysis";
import { DiscordHandlers } from "../../apps/discord/src/handlers.js";
import { discordReport, discordRunnerAlert, reportButtons } from "../../apps/discord/src/report.js";
import { runDiscordRuntime, sendDiscordChannel } from "../../apps/discord/src/runtime.js";
import { discordCommands } from "../../apps/discord/src/commands.js";
import { live, mint, evm } from "./live-fixtures.js";

const guild = "111111111111111111", channel = "222222222222222222", admin = "333333333333333333";
const config = () => loadConfig({ DISCORD_GUILD_ID: guild, DISCORD_CHANNEL_IDS: channel, DISCORD_ADMIN_IDS: admin,
  DISCORD_STARTUP_CHANNEL_ID: channel, DISCORD_BOT_TOKEN: "SECRET" });
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const adapter = { getTokenSnapshot: vi.fn(async () => live()) };
  const scanner = new IntelligenceScanner(adapter);
  const dir = await mkdtemp(join(tmpdir(), "discord-bot-"));
  const runner = new RunnerMonitor(adapter, join(dir, "state.json"), true, ["sol", "bsc", "robinhood"]);
  await runner.init();
  return { adapter, scanner, runner, handlers: new DiscordHandlers(scanner, runner, config()) };
}
function message(content: string, overrides = {}) {
  return { content, guildId: guild, channelId: channel, author: { id: admin, bot: false }, webhookId: null,
    reply: vi.fn(async () => undefined), ...overrides } as unknown as Message;
}
function command(name: string, values: Record<string, string> = {}, user = admin) {
  return { guildId: guild, channelId: channel, user: { id: user }, commandName: name,
    isButton: () => false, isChatInputCommand: () => true,
    options: { getString: (key: string) => values[key] ?? null, getInteger: () => null },
    reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined)
  } as unknown as ChatInputCommandInteraction;
}

describe("Discord scan and permissions", () => {
  it("scans a bare CA using the shared scanner with mentions disabled", async () => {
    const { handlers, adapter } = await fixture();
    const m = message(mint); await handlers.message(m);
    expect(adapter.getTokenSnapshot).toHaveBeenCalledWith(mint, "sol", { forceRefresh: true });
    expect(m.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array), allowedMentions: { parse: [], repliedUser: false } }));
  });
  it.each([
    { guildId: null }, { guildId: "444444444444444444" }, { channelId: "555555555555555555" },
    { author: { id: admin, bot: true } }, { webhookId: "666666666666666666" }
  ])("ignores forbidden surfaces and bots: %j", async (override) => {
    const { handlers, adapter } = await fixture(); const m = message(mint, override);
    await handlers.message(m); expect(adapter.getTokenSnapshot).not.toHaveBeenCalled(); expect(m.reply).not.toHaveBeenCalled();
  });
  it("ignores normal conversation and offers EVM chain buttons without querying", async () => {
    const { handlers, adapter } = await fixture();
    await handlers.message(message("hello everyone"));
    const m = message(evm); await handlers.message(m);
    expect(adapter.getTokenSnapshot).not.toHaveBeenCalled();
    const payload = vi.mocked(m.reply).mock.calls[0][0] as { components: ReturnType<typeof reportButtons>[] };
    expect(JSON.stringify(payload.components[0].toJSON())).toContain(`dc:scan:bsc:${evm}`);
    expect(JSON.stringify(payload.components[0].toJSON())).toContain(`dc:scan:robinhood:${evm}`);
  });
  it("defers slash scans before provider work and enforces a per-user cooldown", async () => {
    const { handlers, adapter } = await fixture(); const c = command("scan", { ca: mint });
    await handlers.interaction(c);
    expect(vi.mocked(c.deferReply).mock.invocationCallOrder[0]).toBeLessThan(adapter.getTokenSnapshot.mock.invocationCallOrder[0]);
    await handlers.message(message(mint));
    expect(adapter.getTokenSnapshot).toHaveBeenCalledOnce();
  });
  it("rejects non-admin mutation before acknowledgement or state writes", async () => {
    const { handlers, runner } = await fixture(); const set = vi.spyOn(runner, "setConfig");
    const c = command("setconfig", { key: "tokenAlerts.enabled", value: "false" }, "444444444444444444");
    await handlers.interaction(c);
    expect(c.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(set).not.toHaveBeenCalled();
  });
  it("allows configured admins to set existing validated fee settings", async () => {
    const { handlers, runner } = await fixture();
    const c = command("setconfig", { key: "bscAlerts.oldTokenVolume.minTotalFeesBnb", value: "1.5" });
    await handlers.interaction(c);
    expect(runner.snapshot().alertConfig.bscAlerts.oldTokenVolume.minTotalFeesBnb).toBe(1.5);
    expect(c.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });
  it("rechecks guild/channel restrictions on components", async () => {
    const { handlers, adapter } = await fixture();
    const c = { ...command(""), guildId: "444444444444444444", isButton: () => true, customId: `dc:scan:sol:${mint}` } as unknown as ButtonInteraction;
    await handlers.interaction(c); expect(adapter.getTokenSnapshot).not.toHaveBeenCalled();
    expect(c.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
  it("rejects unsupported chains and sanitizes provider failures", async () => {
    const { handlers, adapter } = await fixture(); adapter.getTokenSnapshot.mockRejectedValueOnce(new Error("SECRET"));
    const m = message(mint); await handlers.message(m);
    expect(JSON.stringify(vi.mocked(m.reply).mock.calls)).not.toContain("SECRET");
  });
  it("reads runner history without provider requests", async () => {
    const { handlers, adapter } = await fixture(); const c = command("runner", { ca: mint });
    await handlers.interaction(c); expect(adapter.getTokenSnapshot).not.toHaveBeenCalled();
    expect(c.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: "Token belum masuk histori runner Discord." }));
  });
  it("keeps Discord and Telegram state defaults independent and validates Discord IDs", () => {
    expect(loadConfig().discordRunnerStateFile).not.toBe(loadConfig().runnerStateFile);
    expect(() => loadConfig({ DISCORD_GUILD_ID: "not-a-discord-id" })).toThrow();
    expect(loadConfig({ DISCORD_ADMIN_IDS: `${admin}, ${guild}` }).discordAdminIds).toEqual([admin, guild]);
    expect(new Set(discordCommands.map((c) => c.name)).size).toBe(discordCommands.length);
  });
});

describe("Discord reports and delivery", () => {
  it("produces bounded native embeds with GMGN units and without unsafe markdown", async () => {
    const { scanner } = await fixture(); const result = await scanner.scan(mint);
    result.snapshot.name = "**fake**\n".repeat(1000);
    result.snapshot.symbol = "**fake**".repeat(1000);
    result.snapshot.intelligence!.bundlerWalletCount = 42;
    result.snapshot.intelligence!.sniperWalletCount = 0;
    const embed = discordReport(result, true).toJSON();
    const content = JSON.stringify(embed);
    expect(content).toContain("42 wallet"); expect(content).toContain("0 wallet");
    expect(content).not.toContain("42% supply");
    expect(embed.description!.length).toBeLessThan(4096);
    expect(embed.title!.length).toBeLessThanOrEqual(256);
    for (const field of embed.fields!) expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(content.length).toBeLessThan(6000);
  });
  it("renders delayed runner events and preserves the native currency", async () => {
    const { runner } = await fixture(); await runner.observe({ ...live(), observedAt: "2026-01-01T00:00:00.000Z" });
    const event = runner.snapshot().pendingAlerts[0];
    const text = JSON.stringify(discordRunnerAlert(event).toJSON());
    expect(text).toContain("ALERT TERTUNDA"); expect(text).toContain("SOL");
  });
  it("enforces the configured guild before sending and disables all mentions", async () => {
    const send = vi.fn(async () => undefined);
    const client = { channels: { fetch: vi.fn(async () => ({ guildId: guild, isSendable: () => true, send })) } } as unknown as Client;
    await sendDiscordChannel(client, channel, guild, { content: "@everyone" });
    expect(send).toHaveBeenCalledWith({ content: "@everyone", allowedMentions: { parse: [], repliedUser: false } });
    await expect(sendDiscordChannel(client, channel, "444444444444444444", { content: "x" })).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });
  it("keeps a failed Discord delivery pending for retry", async () => {
    const { runner } = await fixture(); await runner.observe(live());
    await runner.deliverNotifications(async () => { throw new Error("SECRET"); });
    expect(runner.snapshot().pendingAlerts).toHaveLength(1);
    expect(runner.snapshot().lastNotificationError).not.toContain("SECRET");
    await runner.deliverNotifications(async () => undefined);
    expect(runner.snapshot().pendingAlerts).toHaveLength(0);
  });
  it("registers guild commands and sends graceful ONLINE/OFFLINE with a final checkpoint", async () => {
    const { runner } = await fixture();
    const signals = new EventEmitter(); const client = new EventEmitter() as unknown as Client;
    const sent: string[] = [];
    Object.assign(client, {
      login: vi.fn(async () => { client.emit(Events.ClientReady, client as Client<true>); return "SECRET"; }),
      destroy: vi.fn(async () => undefined), isReady: () => true,
      application: { commands: { set: vi.fn(async () => undefined) } },
      channels: { fetch: vi.fn(async () => ({ guildId: guild, isSendable: () => true,
        send: async (payload: { content: string }) => { sent.push(payload.content); if (payload.content.includes("DISCORD ONLINE")) signals.emit("SIGTERM"); } })) }
    });
    const checkpoint = vi.spyOn(runner, "checkpoint"); const drain = vi.fn(async () => undefined);
    await runDiscordRuntime(client, runner, config(), { signals, drain });
    expect(client.application!.commands.set).toHaveBeenCalledWith(discordCommands, guild);
    expect(sent).toHaveLength(2); expect(sent[0]).toContain("DISCORD ONLINE"); expect(sent[1]).toContain("DISCORD OFFLINE");
    expect(checkpoint).toHaveBeenCalledOnce(); expect(drain).toHaveBeenCalledOnce(); expect(client.destroy).toHaveBeenCalledOnce();
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
  it.each([true, false])("runs the scheduled outbox with delivery success=%s", async (success) => {
    const { runner } = await fixture(); await runner.observe(live());
    const signals = new EventEmitter(); const client = new EventEmitter() as unknown as Client;
    let delivered = 0;
    Object.assign(client, {
      login: vi.fn(async () => { client.emit(Events.ClientReady, client as Client<true>); return "SECRET"; }),
      destroy: vi.fn(async () => undefined), isReady: () => true,
      application: { commands: { set: vi.fn(async () => undefined) } },
      channels: { fetch: vi.fn(async () => ({ guildId: guild, isSendable: () => true,
        send: async (payload: { embeds?: unknown[] }) => {
          if (!payload.embeds) return;
          delivered++;
          if (!success) throw new Error("SECRET");
        } })) }
    });
    vi.spyOn(runner, "cycle").mockImplementation(async () => { signals.emit("SIGTERM"); return []; });
    await runDiscordRuntime(client, runner, { ...config(), runnerEnabled: true, discordRunnerChannelId: channel }, { signals });
    expect(delivered).toBe(1);
    expect(runner.snapshot().pendingAlerts.length).toBe(success ? 0 : 1);
  });
});
