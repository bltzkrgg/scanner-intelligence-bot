import { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/shared/src/config.js";
import { configureTelegramMenu, sendStartupNotification, statusMessage } from "../../apps/telegram/src/lifecycle.js";

function setup() {
  const bot = new Bot("test-token");
  const request = vi.fn();
  bot.api.config.use(async (_previous, method, payload) => {
    request(method, payload);
    return { ok: true, result: true } as never;
  });
  return { bot, request };
}

describe("Telegram menu and startup notification", () => {
  it("configures the native commands menu", async () => {
    const { bot, request } = setup();
    await configureTelegramMenu(bot);
    expect(request).toHaveBeenCalledWith("setMyCommands", expect.objectContaining({
      commands: expect.arrayContaining([expect.objectContaining({ command: "scan" }), expect.objectContaining({ command: "help" })])
    }));
    expect(request).toHaveBeenCalledWith("setChatMenuButton", { menu_button: { type: "commands" } });
  });

  it("sends only to the configured destination and discloses mock data", async () => {
    const { bot, request } = setup();
    await sendStartupNotification(bot, loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "-10012345" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      chat_id: "-10012345", text: expect.stringContaining("MOCK / data contoh")
    }));
  });

  it("sends nothing if the startup destination is absent or empty", async () => {
    const { bot, request } = setup();
    await sendStartupNotification(bot, loadConfig({}));
    await sendStartupNotification(bot, loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("does not claim that a configured live provider has been verified", () => {
    expect(statusMessage(loadConfig({ GMGN_PROVIDER: "cli" }))).toContain("belum diverifikasi");
    expect(statusMessage(loadConfig({}))).toContain("Jaringan: Solana, BSC, Robinhood Chain (RH)");
    expect(() => loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "not-a-chat" })).toThrow();
  });
});
