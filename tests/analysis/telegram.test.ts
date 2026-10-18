import { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { FixtureGmgnAdapter } from "../../packages/gmgn/src/fixture.js";
import { registerScanHandlers } from "../../apps/telegram/src/handlers/scan.js";
import { registerUtilityCommands } from "../../apps/telegram/src/lifecycle.js";
import { loadConfig } from "../../packages/shared/src/config.js";
import { RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { registerRunnerCommands } from "../../apps/telegram/src/handlers/runner.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  return { send, scan, reply, bot, scanner };
}

describe("Telegram scan routing", () => {
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
    expect(scan).toHaveBeenCalledExactlyOnceWith(mint);
    expect(reply).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      text: expect.stringContaining(mint), parse_mode: "MarkdownV2"
    }));
  });

  it("keeps /scan and group-targeted commands working without duplicate reports", async () => {
    for (const command of ["/scan", "/scan@scanner_bot"]) {
      const { send, scan, reply } = setup();
      await send(`${command} ${mint}`, command);
      expect(scan).toHaveBeenCalledExactlyOnceWith(mint);
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
    registerRunnerCommands(isolated, monitor, scanner, loadConfig({ TELEGRAM_ADMIN_IDS: "99" }));
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
  });
});
