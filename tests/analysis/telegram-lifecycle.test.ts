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
      chat_id: "-10012345", text: expect.stringContaining("MOCK / data contoh"), parse_mode: "HTML"
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
    const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, join(await mkdtemp(join(tmpdir(), "online-state-")), "state.json"), true, ["sol", "bsc", "robinhood"]);
    await runner.setConfig("bscAlerts.enabled", "false");
    await runner.setConfig("tokenAlerts.pollIntervalSec", "90");
    const text = formatStartupNotification(loadConfig({ GMGN_PROVIDER: "cli" }), runner, Date.parse("2026-10-18T10:00:00Z"));
    expect(text).toContain("Solana: <b>Aktif</b> · 90 detik");
    expect(text).toContain("BSC: <b>Nonaktif</b> · 60 detik");
    expect(text).toContain("Belum dikonfigurasi");
    expect(text).toContain("17:00:00 WIB");
    expect(text).toContain("GMGN menunggu verifikasi query");
  });

  it("formats uptime and only claims a saved state after a successful checkpoint", () => {
    const text = formatShutdownNotification("SIGTERM", 0, true, 204 * 60000);
    expect(text).toContain("3 jam 24 menit");
    expect(text).toContain("State terakhir: <b>Berhasil disimpan</b>");
    const failed = formatShutdownNotification("SIGINT", 0, false);
    expect(failed).toContain("GAGAL");
    expect(failed).not.toContain("Berhasil disimpan");
  });

  it("uses option 1 for uniform networks without repeating the same interval", async () => {
    const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, "unused.json", true, ["sol", "bsc", "robinhood"]);
    const text = formatStartupNotification(loadConfig({ GMGN_PROVIDER: "cli", TELEGRAM_RUNNER_CHAT_ID: "123" }), runner,
      Date.parse("2026-10-18T13:58:27Z"));
    expect(text).toContain("<b>🟢 TOKEN INTELLIGENCE</b>\n<b>Bot Online</b>");
    expect(text).toContain("Solana · BSC · Robinhood");
    expect(text).toContain("Data: <b>GMGN Live</b>");
    expect(text).toContain("Polling: <b>60 detik per jaringan</b>");
    expect(text.match(/60 detik/g)).toHaveLength(1);
    expect(text).not.toContain("Pemantauan Jaringan");
    expect(text).toContain("Tujuan alert: <b>Dikonfigurasi</b>");
    expect(text).toContain("18 Okt 2026, 20:58:27 WIB");
    expect(text).not.toContain("Koneksi GMGN sehat");
  });

  it("lists interval differences even if all network alerts are active", async () => {
    const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, join(await mkdtemp(join(tmpdir(), "lifecycle-interval-")), "state.json"), true, ["sol", "bsc", "robinhood"]);
    await runner.setConfig("bscAlerts.pollIntervalSec", "120");
    const text = formatStartupNotification(loadConfig({ GMGN_PROVIDER: "cli" }), runner);
    expect(text).toContain("BSC: <b>Aktif</b> · 120 detik");
    expect(text).toContain("Solana: <b>Aktif</b> · 60 detik");
    expect(text).not.toContain("detik per jaringan");
  });

  it("does not imply network alerts are active when the worker or all alert switches are disabled", async () => {
    const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, join(await mkdtemp(join(tmpdir(), "lifecycle-paused-")), "state.json"), true);
    for (const key of ["tokenAlerts.enabled", "bscAlerts.enabled", "robinhoodAlerts.enabled"]) await runner.setConfig(key, "false");
    expect(formatStartupNotification(loadConfig({}), runner)).toContain("Alert jaringan: <b>Nonaktif</b>");
    await runner.pause(true);
    expect(formatStartupNotification(loadConfig({}), runner)).toContain("Runner: <b>Nonaktif</b>");
  });

  it("renders concise OFFLINE with safe reasons and a truthful checkpoint result", () => {
    const t = Date.parse("2026-10-18T13:58:20Z");
    const text = formatShutdownNotification("menerima sinyal SIGINT", t - 136 * 60000, true, t);
    expect(text).toContain("<b>🔴 TOKEN INTELLIGENCE</b>\n<b>Bot Offline</b>");
    expect(text).toContain("Durasi aktif: <b>2 jam 16 menit</b>");
    expect(text).toContain("Pemicu: <b>SIGINT</b>");
    expect(text).toContain("<i>Berhenti: 18 Okt 2026, 20:58:20 WIB</i>");
    expect(text).not.toContain("Observasi yang sebelumnya gagal");
    const failed = formatShutdownNotification("Error <script> & detail", t, false, t);
    expect(failed).toContain("&lt;script&gt; &amp; detail");
    expect(failed).not.toContain("<script>");
    expect(failed).toContain("GAGAL disimpan");
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
