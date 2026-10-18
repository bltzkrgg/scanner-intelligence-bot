import { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { registerScanHandlers } from "../../apps/telegram/src/handlers/scan.js";
import { registerUtilityCommands } from "../../apps/telegram/src/lifecycle.js";
import { loadConfig } from "../../packages/shared/src/config.js";
import { RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { registerRunnerCommands } from "../../apps/telegram/src/handlers/runner.js";
import { registerConfigCommands } from "../../apps/telegram/src/handlers/config.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evm } from "./live-fixtures.js";

const mint = "So11111111111111111111111111111111111111112";

function setup() {
  const bot = new Bot("test-token", {
    botInfo: {
      id: 1, is_bot: true, first_name: "Scanner", username: "scanner_bot",
      can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
      allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false
    }
  });
  const scanner = new IntelligenceScanner(new FixtureGmgnAdapter());
  const scan = vi.spyOn(scanner, "scan");
  const reply = vi.fn();
  bot.api.config.use(async (_previous, method, payload) => {
    reply(method, payload);
    return { ok: true, result: true } as never;
  });
  registerUtilityCommands(bot, loadConfig({}));
  registerScanHandlers(bot, scanner);

  async function send(text: string, command?: string) {
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1, date: 0, chat: { id: 2, type: "private", first_name: "User" },
        from: { id: 2, is_bot: false, first_name: "User" }, text,
        ...(command ? { entities: [{ type: "bot_command" as const, offset: 0, length: command.length }] } : {})
      }
    });
  }
  async function press(data: string) {
    await bot.handleUpdate({ update_id: 3, callback_query: {
      id: "callback-id", chat_instance: "chat-instance", data,
      from: { id: 2, is_bot: false, first_name: "User" },
      message: { message_id: 1, date: 1, chat: { id: 2, type: "private", first_name: "User" }, text: "Pilih chain" }
    } });
  }
  return { send, press, scan, reply, bot, scanner };
}

describe("Telegram scan routing", () => {
  it("restricts config commands to admins and replies to validation failures", async () => {
    const { bot } = setup();
    const file = join(await mkdtemp(join(tmpdir(), "telegram-config-")), "state.json");
    const monitor = new RunnerMonitor(new FixtureGmgnAdapter(), file, true);
    const isolated = new Bot("test-token", { botInfo: bot.botInfo });
    const reply = vi.fn();
    isolated.api.config.use(async (_previous, method, payload) => {
      reply(method, payload);
      return { ok: true, result: true } as never;
    });
    registerConfigCommands(isolated, monitor, loadConfig({ TELEGRAM_ADMIN_IDS: "99" }));
    async function send(text: string, id = 99) {
      await isolated.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0,
        chat: { id: 99, type: "private", first_name: "Admin" }, from: { id, is_bot: false, first_name: "Admin" }, text,
        entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } });
    }
    await send("/setconfig tokenAlerts.pollIntervalSec 15", 2);
    expect(monitor.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(60);
    await send("/setconfig tokenAlerts.pollIntervalSec 15");
    expect(monitor.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(15);
    await send("/setconfig tokenAlerts.pollIntervalSec 1");
    expect(monitor.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(15);
    await send("/getconfig tokenAlerts");
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("tokenAlerts.pollIntervalSec: 15") }));
    await send("/setconfig bscAlerts.minTotalFeesBnb 0.25", 2);
    expect(monitor.snapshot().alertConfig.bscAlerts.minTotalFeesBnb).toBe(0.5);
    await send("/setconfig bscAlerts.minTotalFeesBnb 0.25");
    await send("/setconfig bscAlerts.pollIntervalSec 1");
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringMatching(/^bscAlerts\.pollIntervalSec:/) }));
    await send("/getconfig bscAlerts");
    expect(reply).toHaveBeenLastCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("bscAlerts.minTotalFeesBnb: 0.25") }));
    const restored = new RunnerMonitor(new FixtureGmgnAdapter(), file, true);
    await restored.init();
    expect(restored.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(15);
    expect(restored.snapshot().alertConfig.bscAlerts.minTotalFeesBnb).toBe(0.25);
  });
  it("asks for a network for bare EVM addresses and scans only after selection", async () => {
    const { send, press, scan, reply } = setup();
    await send(evm);
    expect(scan).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
    }));
    await press(`scan:robinhood:${evm}`);
    expect(scan).toHaveBeenCalledExactlyOnceWith(evm, "robinhood");
    expect(reply).toHaveBeenCalledWith("answerCallbackQuery", expect.anything());
  });

  it("accepts explicit BSC and RH network labels", async () => {
    const { send, scan } = setup();
    await send(`/scan bsc ${evm}`, "/scan");
    await send(`rh:${evm}`);
    expect(scan).toHaveBeenNthCalledWith(1, evm, "bsc");
    expect(scan).toHaveBeenNthCalledWith(2, evm, "robinhood");
  });
  it("handles menu commands without invoking the scanner", async () => {
    const { send, scan, reply } = setup();
    await send("/help", "/help");
    await send("/status", "/status");
    await send("/chatid", "/chatid");
    expect(scan).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(3);
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: "Chat ID: 2\nUser ID: 2" }));
  });
  it("scans a standalone mint and sends the report", async () => {
    const { send, scan, reply } = setup();
    await send(`  ${mint}  `);
    expect(scan).toHaveBeenCalledExactlyOnceWith(mint, "sol");
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      text: expect.stringContaining(mint), parse_mode: "MarkdownV2"
    }));
  });

  it("keeps /scan and group-targeted commands working without duplicate reports", async () => {
    for (const command of ["/scan", "/scan@scanner_bot"]) {
      const { send, scan, reply } = setup();
      await send(`${command} ${mint}`, command);
      expect(scan).toHaveBeenCalledExactlyOnceWith(mint, "sol");
      expect(reply).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores conversation and other commands", async () => {
    const { send, scan, reply } = setup();
    await send("halo");
    await send(`cek ${mint}`);
    await send("/other", "/other");
    expect(scan).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("replies when the provider fails", async () => {
    const { send, scan, reply } = setup();
    scan.mockRejectedValueOnce(new Error("Provider unavailable"));
    await send(mint);
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      text: expect.stringContaining("data belum bisa diproses")
    }));
  });

  it("only lets configured user IDs control persistent runner state", async () => {
    const { reply, bot, scanner } = setup();
    const file = join(await mkdtemp(join(tmpdir(), "runner-command-")), "state.json");
    const monitor = new RunnerMonitor(new FixtureGmgnAdapter(), file, true);
    await monitor.init();
    // Commands must precede the text catch-all, matching the production bot.
    const isolated = new Bot("test-token", { botInfo: bot.botInfo });
    isolated.api.config.use(async (_previous, method, payload) => {
      reply(method, payload);
      return { ok: true, result: true } as never;
    });
    registerRunnerCommands(isolated, monitor, scanner, loadConfig({ TELEGRAM_ADMIN_IDS: "99", TELEGRAM_RUNNER_CHAT_ID: "-100456" }));
    const update = {
      update_id: 2,
      message: { message_id: 2, date: 0, chat: { id: 2, type: "private" as const, first_name: "User" },
        from: { id: 2, is_bot: false, first_name: "User" }, text: "/runner_off",
        entities: [{ type: "bot_command" as const, offset: 0, length: 11 }] }
    };
    await isolated.handleUpdate(update);
    expect(monitor.active).toBe(true);
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("khusus user ID") }));
    update.message.from.id = 99;
    await isolated.handleUpdate(update);
    expect(monitor.active).toBe(false);
    const restored = new RunnerMonitor(new FixtureGmgnAdapter(), file, true);
    await restored.init();
    expect(restored.active).toBe(false);
    update.message.text = "/runner_test";
    update.message.entities[0].length = 12;
    await isolated.handleUpdate(update);
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ chat_id: "-100456", text: expect.stringContaining("TES NOTIFIKASI") }));
  });
});
