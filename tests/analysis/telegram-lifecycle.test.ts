import { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/shared/src/config.js";
import { configureTelegramMenu, sendStartupNotification, statusMessage, formatStartupNotification, formatShutdownNotification, sendStatusMessage } from "../../apps/telegram/src/lifecycle.js";
import { RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { live } from "./live-fixtures.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  it("reports actual runtime chain settings and missing runner destination on ONLINE", async () => {
    const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, join(await mkdtemp(join(tmpdir(), "online-state-")), "state.json"), true);
    await runner.setConfig("bscAlerts.enabled", "false");
    await runner.setConfig("tokenAlerts.pollIntervalSec", "90");
    const text = formatStartupNotification(loadConfig({ GMGN_PROVIDER: "cli" }), runner, Date.parse("2026-10-18T10:00:00Z"));
    expect(text).toContain("Solana: Aktif | polling 90 detik");
    expect(text).toContain("BSC: Nonaktif | polling 60 detik");
    expect(text).toContain("BELUM DIISI");
    expect(text).toContain("17:00:00 WIB");
    expect(text).toContain("GMGN belum diverifikasi");
  });

  it("formats uptime and only claims a saved state after a successful checkpoint", () => {
    const text = formatShutdownNotification("SIGTERM", 0, true, 204 * 60000);
    expect(text).toContain("3 jam 24 menit");
    expect(text).toContain("snapshot state terakhir berhasil disimpan");
    const failed = formatShutdownNotification("SIGINT", 0, false);
    expect(failed).toContain("GAGAL");
    expect(failed).not.toContain("berhasil disimpan");
  });

  it("aborts a hanging lifecycle notification after five seconds", async () => {
    vi.useFakeTimers();
    try {
      const bot = new Bot("test-token");
      bot.api.config.use(async (_previous, _method, _payload, signal) => new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const pending = expect(sendStatusMessage(bot, "123", "test")).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
    } finally { vi.useRealTimers(); }
  });
});
