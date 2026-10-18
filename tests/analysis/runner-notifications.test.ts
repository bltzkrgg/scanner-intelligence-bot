import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { live, evm } from "./live-fixtures.js";
import { Bot } from "grammy";
import { loadConfig } from "../../packages/shared/src/config.js";
import { sendRunnerNotifications } from "../../apps/telegram/src/lifecycle.js";

async function setup() {
  const file = join(await mkdtemp(join(tmpdir(), "runner-alert-")), "state.json");
  const adapter = { getTokenSnapshot: async () => live() };
  const monitor = new RunnerMonitor(adapter, file, true, ["sol", "bsc", "robinhood"]);
  await monitor.init();
  return { file, adapter, monitor };
}

describe("persistent runner notifications", () => {
  it("isolates BSC/RH histories and emits each milestone once", async () => {
    const { monitor } = await setup();
    const s = { ...live(), mint: evm };
    const time = Date.now();
    await monitor.observe({ ...s, chain: "bsc", observedAt: new Date(time).toISOString() });
    await monitor.observe({ ...s, chain: "robinhood", priceUsd: 10, observedAt: new Date(time).toISOString() });
    await monitor.observe({ ...s, chain: "bsc", priceUsd: 5, observedAt: new Date(time + 1000).toISOString() });
    await monitor.observe({ ...s, chain: "bsc", priceUsd: 6, observedAt: new Date(time + 2000).toISOString() });
    const state = monitor.snapshot();
    expect(state.records).toHaveLength(2);
    expect(state.pendingAlerts.map((event) => event.kind)).toEqual(["candidate", "candidate", "2x", "5x"]);
    expect(state.records.find((r) => r.chain === "robinhood")?.reached2xAt).toBeNull();
    expect(formatRunnerNotification(state.pendingAlerts[1])).toContain("Robinhood Chain");
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send);
    await monitor.deliverNotifications(send);
    expect(send).toHaveBeenCalledTimes(4);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
  });

  it("retains failed notifications across restarts and acknowledges success", async () => {
    const { monitor, file, adapter } = await setup();
    await monitor.observe(live());
    await monitor.deliverNotifications(async () => { throw new Error("Telegram offline"); });
    expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    expect(monitor.snapshot().lastNotificationError).not.toBeNull();
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    const send = vi.fn(async () => undefined);
    await restored.deliverNotifications(send);
    expect(send).toHaveBeenCalledOnce();
    expect(restored.snapshot().pendingAlerts).toHaveLength(0);
    expect(restored.snapshot().lastNotificationError).toBeNull();
  });

  it("migrates v1 Solana state without replaying old detection alerts", async () => {
    const { monitor, file, adapter } = await setup();
    await monitor.observe(live());
    const old = { version: 1, paused: false, lastCycleAt: null, lastError: null,
      records: monitor.snapshot().records.map(({ chain, ...record }) => record) };
    await writeFile(file, JSON.stringify(old));
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    expect(restored.snapshot().version).toBe(3);
    expect(restored.snapshot().records[0].chain).toBe("sol");
    expect(restored.snapshot().pendingAlerts).toHaveLength(0);
    await restored.pause(true);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(3);
  });

  it("does not send while paused, and deletion only removes that chain's events", async () => {
    const { monitor } = await setup();
    await monitor.observe({ ...live(), chain: "bsc", mint: evm });
    await monitor.observe({ ...live(), chain: "robinhood", mint: evm });
    await monitor.pause(true);
    const send = vi.fn(async () => undefined);
    await monitor.deliverNotifications(send);
    expect(send).not.toHaveBeenCalled();
    await monitor.remove(evm, "bsc");
    expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    expect(monitor.snapshot().pendingAlerts[0].record.chain).toBe("robinhood");
  });

  it("sends only to the dedicated configured Telegram destination", async () => {
    const { monitor } = await setup();
    await monitor.observe(live());
    const bot = new Bot("test-token");
    const request = vi.fn();
    bot.api.config.use(async (_previous, method, payload) => {
      request(method, payload);
      return { ok: true, result: true } as never;
    });
    await sendRunnerNotifications(bot, monitor, loadConfig({ TELEGRAM_STARTUP_CHAT_ID: "12" }));
    expect(request).not.toHaveBeenCalled();
    await sendRunnerNotifications(bot, monitor, loadConfig({ TELEGRAM_RUNNER_CHAT_ID: "-100456" }));
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      chat_id: "-100456", text: expect.stringContaining("SOLANA TOKEN RUNNER"), parse_mode: "HTML",
      reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
    }));
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
  });

  it("does not let disabled-chain backlog block enabled-chain notifications", async () => {
    const { monitor, file, adapter } = await setup();
    await monitor.observe({ ...live(), chain: "bsc", mint: evm });
    await monitor.observe(live());
    const solOnly = new RunnerMonitor(adapter, file, true, ["sol"]);
    await solOnly.init();
    const send = vi.fn(async () => undefined);
    await solOnly.deliverNotifications(send);
    expect(send).toHaveBeenCalledOnce();
    expect(solOnly.snapshot().pendingAlerts).toHaveLength(1);
    expect(solOnly.snapshot().pendingAlerts[0].record.chain).toBe("bsc");
  });

  it("discovers and tracks each network separately", async () => {
    const { file } = await setup();
    const adapter = {
      discoverTokens: vi.fn(async (chain: string = "sol") => chain === "sol" ? [live().mint] : [evm]),
      getTokenSnapshot: vi.fn(async (mint: string, chain: "sol" | "bsc" | "robinhood" = "sol") => ({ ...live(), mint, chain }))
    };
    const monitor = new RunnerMonitor(adapter, file, true, ["sol", "bsc", "robinhood"]);
    await monitor.init();
    await monitor.cycle();
    expect(adapter.discoverTokens.mock.calls.map(([chain]) => chain)).toEqual(["sol", "bsc", "robinhood"]);
    expect(monitor.snapshot().records.map((record) => record.chain)).toEqual(["sol", "bsc", "robinhood"]);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(3);
  });
});
