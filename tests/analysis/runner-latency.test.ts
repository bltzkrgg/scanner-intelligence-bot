import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bot, GrammyError } from "grammy";
import { loadConfig, type Chain } from "../../packages/shared/src/index.js";
import { RunnerMonitor, type RunnerEvent } from "../../packages/analysis/src/runner.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { sendRunnerNotifications } from "../../apps/telegram/src/lifecycle.js";
import { live, mint, otherMint } from "./live-fixtures.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const stateFile = async () => join(await mkdtemp(join(tmpdir(), "runner-latency-")), "state.json");

describe("runner latency regressions", () => {
  it("delivers a persisted observation before the next slow token or chain finishes", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const query = vi.fn(async (address: string) => {
      if (address === otherMint) await blocked;
      return { ...live(), mint: address };
    });
    const monitor = new RunnerMonitor({ discoverTokens: async () => [mint, otherMint], getTokenSnapshot: query }, await stateFile(), true);
    await monitor.init();
    const sent = vi.fn(async (_event: RunnerEvent) => undefined);
    const counts: Partial<Record<Chain, number>> = {};
    const cycle = monitor.cycle({ onObservation: () => monitor.deliverNotifications(sent, undefined, counts) });
    try {
      await vi.waitFor(() => expect(query).toHaveBeenCalledWith(otherMint, "sol"));
      expect(sent).toHaveBeenCalledOnce();
      expect(sent.mock.calls[0][0].record.mint).toBe(mint);
      expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
    } finally { release(); await cycle; }
    expect(sent).toHaveBeenCalledTimes(2);
    expect(monitor.snapshot().cycleTiming!.queriedTokens).toBe(2);
    expect(monitor.snapshot().cycleTiming!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("shares maxPerScan across streaming flushes and keeps failed/excess events queued", async () => {
    const monitor = new RunnerMonitor({ discoverTokens: async () => [mint, otherMint],
      getTokenSnapshot: async (address) => ({ ...live(), mint: address }) }, await stateFile(), true);
    await monitor.init(); await monitor.setConfig("tokenAlerts.maxPerScan", "1");
    const counts: Partial<Record<Chain, number>> = {};
    const send = vi.fn(async () => undefined);
    const flush = () => monitor.deliverNotifications(send, undefined, counts);
    await monitor.cycle({ onObservation: flush }); await flush();
    expect(send).toHaveBeenCalledOnce(); expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    await monitor.deliverNotifications(async () => { throw new Error("offline"); });
    expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    expect(monitor.snapshot().lastNotificationError).not.toBeNull();
    await monitor.deliverNotifications(send);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
  });

  it("prioritizes newly discovered tokens before the tracked backlog", async () => {
    const query = vi.fn(async (address: string) => ({ ...live(), mint: address }));
    const monitor = new RunnerMonitor({ discoverTokens: async () => [otherMint], getTokenSnapshot: query }, await stateFile(), true);
    await monitor.init(); await monitor.observe(live()); await monitor.cycle();
    expect(query.mock.calls.map(([address]) => address)).toEqual([otherMint, mint]);
  });

  it("alternates chains so one tracked backlog cannot monopolize the cycle", async () => {
    const bscMint = "0x1111111111111111111111111111111111111111";
    const bscMint2 = "0x2222222222222222222222222222222222222222";
    const query = vi.fn(async (address: string, chain: Chain = "sol") => ({ ...live(), mint: address, chain }));
    const monitor = new RunnerMonitor({ discoverTokens: async (chain) => chain === "sol" ? [mint, otherMint] : [bscMint, bscMint2],
      getTokenSnapshot: query }, await stateFile(), true, ["sol", "bsc"]);
    await monitor.init(); await monitor.cycle();
    expect(query.mock.calls.map(([, chain]) => chain)).toEqual(["sol", "bsc", "sol", "bsc"]);
  });

  it("refreshes discovery after 15 seconds instead of the five-minute enrichment cache", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi.fn(async () => Response.json({ status: "success", data: [{ mint }] })) as unknown as typeof fetch;
    const adapter = new EnrichedAdapter({ getTokenSnapshot: async () => live() },
      loadConfig({ SOLANA_TRACKER_API_KEY: "fake", ENRICHMENT_CACHE_SEC: "300" }), fetcher);
    await adapter.discoverTokens("sol"); now.mockReturnValue(14000); await adapter.discoverTokens("sol");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(15000); await adapter.discoverTokens("sol");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("starts independent authority and FOMO requests while Tracker is still pending", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const paths: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input)); paths.push(url.hostname + url.pathname);
      if (url.hostname === "data.solanatracker.io") {
        await blocked; return Response.json({ token: { mint }, pools: [] });
      }
      if (url.hostname === "mainnet.helius-rpc.com") return Response.json({ result: { value: {
        owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint", info: {
          mintAuthority: null, freezeAuthority: null
        } } }
      } } });
      return Response.json(url.pathname.includes("leaderboard")
        ? { window: "7d", capturedAt: new Date().toISOString(), traders: [] }
        : { scope: "live-top-holders", holders: [] });
    }) as typeof fetch;
    const adapter = new EnrichedAdapter({ getTokenSnapshot: async () => live() },
      loadConfig({ SOLANA_TRACKER_API_KEY: "fake", HELIUS_API_KEY: "fake", FOMO_API_KEY: "fake" }), fetcher);
    const result = adapter.getTokenSnapshot(mint);
    try {
      await vi.waitFor(() => expect(paths).toContain("api.fomoapi.io/v2/leaderboard/7d"));
      expect(paths).toContain("mainnet.helius-rpc.com/");
    } finally { release(); }
    expect((await result).intelligence!.sources).toEqual(["GMGN", "Solana Tracker", "Helius", "FOMO"]);
  });

  it("retains a timed-out Telegram event and retries without a new provider scan", async () => {
    const monitor = new RunnerMonitor({ getTokenSnapshot: async () => live() }, await stateFile(), true);
    await monitor.init(); await monitor.observe(live());
    const bot = new Bot("fake");
    const send = vi.spyOn(bot.api, "sendMessage").mockImplementation(async (_chat, _text, _options, signal) => {
      await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return {} as never;
    });
    const config = loadConfig({ TELEGRAM_RUNNER_CHAT_ID: "123" });
    vi.useFakeTimers();
    const sending = sendRunnerNotifications(bot, monitor, config);
    await vi.advanceTimersByTimeAsync(5000); await sending;
    expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    send.mockResolvedValue({} as never);
    await sendRunnerNotifications(bot, monitor, config); expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); await sendRunnerNotifications(bot, monitor, config);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0); expect(send).toHaveBeenCalledTimes(2);
  });

  it("respects Telegram retry_after while retaining the outbox", async () => {
    const monitor = new RunnerMonitor({ getTokenSnapshot: async () => live() }, await stateFile(), true);
    await monitor.init(); await monitor.observe(live());
    const bot = new Bot("fake");
    const send = vi.spyOn(bot.api, "sendMessage").mockRejectedValueOnce(new GrammyError("send", {
      ok: false, error_code: 429, description: "rate limited", parameters: { retry_after: 30 }
    }, "sendMessage", {}));
    vi.useFakeTimers();
    const config = loadConfig({ TELEGRAM_RUNNER_CHAT_ID: "123" });
    await sendRunnerNotifications(bot, monitor, config);
    await vi.advanceTimersByTimeAsync(10000); await sendRunnerNotifications(bot, monitor, config);
    expect(send).toHaveBeenCalledOnce(); expect(monitor.snapshot().pendingAlerts).toHaveLength(1);
    send.mockResolvedValue({} as never);
    await vi.advanceTimersByTimeAsync(20000); await sendRunnerNotifications(bot, monitor, config);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);
  });
});
