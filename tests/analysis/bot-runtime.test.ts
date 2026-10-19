import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { loadConfig } from "../../packages/shared/src/config.js";
import { runTelegramRuntime } from "../../apps/telegram/src/runtime.js";
import { live } from "./live-fixtures.js";

async function setup(enabled = false, runnerChat = false) {
  const bot = new Bot("test-token");
  const signals = new EventEmitter();
  const request = vi.fn();
  bot.api.config.use(async (_previous, method, payload) => {
    request(method, payload);
    return { ok: true, result: true } as never;
  });
  let running = false;
  let finish!: () => void;
  const drained = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(bot, "start").mockImplementation(async (options) => {
    running = true;
    await options?.onStart?.({} as never);
    await drained;
  });
  vi.spyOn(bot, "isRunning").mockImplementation(() => running);
  const stop = vi.spyOn(bot, "stop").mockImplementation(async () => { running = false; });
  const file = join(await mkdtemp(join(tmpdir(), "bot-runtime-")), "state.json");
  const runner = new RunnerMonitor({ getTokenSnapshot: async () => live() }, file, enabled);
  await runner.init();
  const checkpoint = vi.spyOn(runner, "checkpoint");
  const config = loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "123", TELEGRAM_RUNNER_CHAT_ID: runnerChat ? "456" : undefined,
    RUNNER_ENABLED: String(enabled), BOT_SHUTDOWN_TIMEOUT_SEC: "10" });
  const forceExit = vi.fn();
  const run = () => runTelegramRuntime(bot, runner, config, { signals, forceExit });
  const online = () => vi.waitFor(() => expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("<b>Bot Online</b>") })));
  return { bot, signals, request, finish, stop, runner, checkpoint, forceExit, run, online };
}

describe("whole-bot lifecycle", () => {
  it("sends runner alerts from the observation callback before the cycle completes", async () => {
    const s = await setup(true, true);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(s.runner, "cycle").mockImplementation(async (options) => {
      options?.onChainStart?.("sol"); await s.runner.observe(live());
      await options?.onObservation?.(); await blocked; return ["sol"];
    });
    const task = s.run();
    try {
      await vi.waitFor(() => expect(s.request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
        chat_id: "456", text: expect.stringContaining("SOLANA TOKEN RUNNER")
      })));
      await vi.waitFor(() => expect(s.runner.snapshot().pendingAlerts).toHaveLength(0));
    } finally { s.signals.emit("SIGTERM"); release(); s.finish(); await task; }
  });
  it("sends ONLINE then one OFFLINE only after middleware drains and state saves", async () => {
    const s = await setup();
    const task = s.run();
    await s.online();
    s.signals.emit("SIGTERM");
    s.signals.emit("SIGINT");
    expect(s.stop).toHaveBeenCalledOnce();
    expect(s.checkpoint).not.toHaveBeenCalled();
    expect(JSON.stringify(s.request.mock.calls)).not.toContain("<b>Bot Offline</b>");
    s.finish();
    await task;
    expect(s.checkpoint).toHaveBeenCalledOnce();
    const messages = s.request.mock.calls.filter(([method]) => method === "sendMessage").map(([, payload]) => payload.text);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("<b>Bot Online</b>");
    expect(messages[1]).toContain("<b>Bot Offline</b>");
    expect(messages[1]).toContain("SIGTERM");
    expect(messages[1]).toContain("State terakhir: <b>Berhasil disimpan</b>");
    expect(s.signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("does not claim persistence succeeded if the checkpoint fails", async () => {
    const s = await setup();
    s.checkpoint.mockRejectedValue(new Error("read-only"));
    const task = s.run();
    await s.online();
    s.signals.emit("SIGINT");
    s.finish();
    await task;
    expect(s.request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("GAGAL disimpan") }));
  });

  it("waits for an in-flight runner cycle before the final checkpoint", async () => {
    const s = await setup(true);
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const cycle = vi.spyOn(s.runner, "cycle").mockImplementation(async () => { await pending; return []; });
    const task = s.run();
    await vi.waitFor(() => expect(cycle).toHaveBeenCalled());
    s.signals.emit("SIGTERM");
    s.finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.checkpoint).not.toHaveBeenCalled();
    complete();
    await task;
    expect(s.checkpoint).toHaveBeenCalledOnce();
  });

  it("bounds shutdown time without sending a false success message", async () => {
    const s = await setup();
    const task = s.run();
    await s.online();
    vi.useFakeTimers();
    try {
      s.signals.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(10000);
      expect(s.forceExit).toHaveBeenCalledWith(1);
      expect(JSON.stringify(s.request.mock.calls)).not.toContain("<b>Bot Offline</b>");
      s.finish();
      await task;
    } finally { vi.useRealTimers(); }
  });

  it("reports a runtime failure without leaking raw exception details", async () => {
    const s = await setup();
    vi.mocked(s.bot.start).mockRejectedValueOnce(new Error("secret credential"));
    const exitCode = process.exitCode;
    try {
      await s.run();
      expect(process.exitCode).toBe(1);
      expect(JSON.stringify(s.request.mock.calls)).not.toContain("secret credential");
      expect(s.request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("startup atau polling Telegram gagal") }));
    } finally { process.exitCode = exitCode; }
  });
});
