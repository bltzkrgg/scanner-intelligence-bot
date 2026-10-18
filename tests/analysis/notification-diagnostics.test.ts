import { Bot, GrammyError, HttpError } from "grammy";
import { runInNewContext } from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/shared/src/config.js";
import { notificationErrorMessage, sendStartupNotification, sendShutdownNotification, registerUtilityCommands } from "../../apps/telegram/src/lifecycle.js";

describe("lifecycle notification diagnostics", () => {
  it("uses the actual grammY HTTP transport path with a compatible abort signal", async () => {
    const fetch = vi.fn(async (_url, options) => {
      expect(options.signal.addEventListener).toBeTypeOf("function");
      const payload = JSON.parse(options.body);
      expect(payload.chat_id).toBe("123");
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    });
    const bot = new Bot("test-token", { client: { fetch: fetch as never } });
    const config = loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "123" });
    expect(await sendStartupNotification(bot, config)).toBe(true);
    expect(await sendShutdownNotification(bot, config, "SIGINT", Date.now(), true)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain("| ONLINE");
    expect(JSON.parse(fetch.mock.calls[1][1].body).text).toContain("| OFFLINE");
  });

  it("returns disabled explicitly instead of reporting a successful send", async () => {
    const fetch = vi.fn();
    const bot = new Bot("test-token", { client: { fetch: fetch as never } });
    expect(await sendStartupNotification(bot, loadConfig({}))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("classifies Telegram permission and chat errors without exposing request payloads", () => {
    const error = (code: number, description: string) => new GrammyError("secret-token-in-message", {
      ok: false, error_code: code, description
    }, "sendMessage", { private_secret: "do-not-print-this" });
    expect(notificationErrorMessage(error(400, "Bad Request: chat not found"))).toContain("chat tujuan tidak ditemukan");
    expect(notificationErrorMessage(error(403, "Forbidden: bot was blocked"))).toContain("bot diblokir");
    expect(notificationErrorMessage(error(401, "Unauthorized"))).toContain("token tidak valid");
    expect(notificationErrorMessage(error(429, "Too many requests"))).toContain("rate limit");
    expect(notificationErrorMessage(error(400, "secret-raw-description"))).not.toContain("secret");
    expect(notificationErrorMessage(new Error("secret-token-in-message"))).not.toContain("secret");
    expect(notificationErrorMessage(new HttpError("hidden", new Error("timeout")))).toContain("timeout");
  });

  it("reports test failure and last delivery state to the admin, while rejecting non-admins", async () => {
    const bot = new Bot("test-token", { botInfo: { id: 1, is_bot: true, first_name: "Test", username: "test_bot",
      can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
      allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false } });
    const request = vi.fn();
    bot.api.config.use(async (_previous, method, payload) => {
      request(method, payload);
      if (method === "sendMessage" && "chat_id" in payload && payload.chat_id === "999") return { ok: false, error_code: 400, description: "Bad Request: chat not found" } as never;
      return { ok: true, result: true } as never;
    });
    registerUtilityCommands(bot, loadConfig({ TELEGRAM_ADMIN_IDS: "2", TELEGRAM_STARTUP_CHAT_ID: "999" }));
    async function command(text: string, id: number) {
      await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1,
        chat: { id, type: "private", first_name: "User" }, from: { id, is_bot: false, first_name: "User" }, text,
        entities: [{ type: "bot_command", offset: 0, length: text.length }] } });
    }
    await command("/notification_test", 3);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("khusus user ID") }));
    await command("/notification_test", 2);
    expect(request).toHaveBeenLastCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("chat tujuan tidak ditemukan") }));
    await command("/status", 2);
    expect(request).toHaveBeenLastCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("TEST gagal") }));
  });

  it("loads an absolute PM2 entry point and overrides stale startup-chat environment", async () => {
    const source = await readFile(new URL("../../ecosystem.config.cjs", import.meta.url), "utf8");
    const realRequire = createRequire(import.meta.url);
    type App = { cwd: string; script: string; interpreter: string; env: Record<string, string>; kill_timeout: number; instances: number };
    const module = { exports: {} as { apps: App[] } };
    runInNewContext(source, { module, __dirname: "/test/repo", process: { execPath: "/node24/bin/node" },
      require: (name: string) => name === "node:fs" ? { readFileSync: () => "TELEGRAM_STARTUP_CHAT_ID=123\nBOT_SHUTDOWN_TIMEOUT_SEC=60\n" } : realRequire(name) });
    const app = module.exports.apps[0];
    expect(app.cwd).toBe("/test/repo");
    expect(app.script).toBe("/test/repo/apps/telegram/src/bot.ts");
    expect(app.interpreter).toBe("/node24/bin/node");
    expect(app.env.TELEGRAM_STARTUP_CHAT_ID).toBe("123");
    expect(app.kill_timeout).toBe(65000);
    expect(app.instances).toBe(1);
  });
});
