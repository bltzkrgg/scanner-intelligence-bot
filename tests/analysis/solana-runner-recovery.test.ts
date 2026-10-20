import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@sti/shared";
import { RunnerMonitor } from "../../packages/analysis/src/runner.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { statusMessage } from "../../apps/telegram/src/lifecycle.js";
import { live, mint, otherMint } from "./live-fixtures.js";

const settings = () => loadConfig({ SOLANA_TRACKER_API_KEY: "fake-key" });
const base = () => ({ getTokenSnapshot: vi.fn(async () => live()), discoverTokens: vi.fn(async () => [otherMint]) });
const stateFile = async () => join(await mkdtemp(join(tmpdir(), "solana-recovery-")), "state.json");

describe("Solana runner discovery recovery", () => {
  it.each([401, 403, 429, 500])("uses live GMGN discovery after Tracker HTTP %s", async (status) => {
    const b = base();
    const fetcher = vi.fn(async () => new Response("rejected", { status })) as unknown as typeof fetch;
    const adapter = new EnrichedAdapter(b, settings(), fetcher);
    expect(await adapter.discoverTokens("sol")).toEqual([otherMint]);
    expect(b.discoverTokens).toHaveBeenCalledWith("sol");
  });

  it.each([null, { status: "success", data: [] }, { status: "success", data: [{ mint: "invalid" }] }])(
    "falls back on empty or invalid Tracker discovery: %j", async (value) => {
      const b = base();
      const adapter = new EnrichedAdapter(b, settings(), (async () => Response.json(value)) as typeof fetch);
      expect(await adapter.discoverTokens("sol")).toEqual([otherMint]);
    });

  it("surfaces failure when both live discovery sources fail", async () => {
    const b = base();
    b.discoverTokens.mockRejectedValue(new Error("GMGN unavailable"));
    const adapter = new EnrichedAdapter(b, settings(), (async () => { throw new Error("Tracker unavailable"); }) as typeof fetch);
    await expect(adapter.discoverTokens("sol")).rejects.toThrow("GMGN unavailable");
  });

  it("keeps Tracker primary on success and never calls it for BSC/RH", async () => {
    const b = base();
    const fetcher = vi.fn(async () => Response.json({ status: "success", data: [{ mint }] })) as unknown as typeof fetch;
    const adapter = new EnrichedAdapter(b, settings(), fetcher);
    expect(await adapter.discoverTokens("sol")).toEqual([mint]);
    expect(b.discoverTokens).not.toHaveBeenCalled();
    await adapter.discoverTokens("bsc");
    await adapter.discoverTokens("robinhood");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(b.discoverTokens.mock.calls).toEqual([["bsc"], ["robinhood"]]);
  });
});

describe("Solana alerts with full tracking history", () => {
  it("delivers a new 120K candidate once despite 50 saved tokens, including after restart", async () => {
    const file = await stateFile();
    const adapter = base();
    const monitor = new RunnerMonitor(adapter, file, true);
    await monitor.init();
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const t = Date.now();
    for (let n = 0; n < 50; n++) await monitor.observe({ ...live(), mint: mint.slice(0, -2) + "A" + alphabet[n],
      observedAt: new Date(t).toISOString() });
    await monitor.setConfig("tokenAlerts.maxPerScan", "50");
    await monitor.deliverNotifications(async () => undefined);
    expect(monitor.snapshot().records).toHaveLength(50);
    expect(monitor.snapshot().pendingAlerts).toHaveLength(0);

    const snapshot = { ...live(), mint: otherMint, volume5mUsd: 120000, observedAt: new Date(t + 1000).toISOString() };
    await monitor.observe(snapshot);
    expect(monitor.snapshot().records).toHaveLength(50);
    expect(monitor.snapshot().pendingAlerts.map((event) => event.kind)).toEqual(["candidate"]);
    expect(statusMessage(loadConfig({ ENABLED_CHAINS: "sol" }), monitor)).toContain("Solana: AKTIF | histori 50/50 | antrean 1");
    await monitor.deliverNotifications(async () => { throw new Error("Telegram unavailable"); });
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    await restored.observe({ ...snapshot, observedAt: new Date(t + 2000).toISOString() });
    expect(restored.snapshot().pendingAlerts).toHaveLength(1);
    const send = vi.fn(async () => undefined);
    await restored.deliverNotifications(send);
    await restored.observe({ ...snapshot, observedAt: new Date(t + 3000).toISOString() });
    expect(send).toHaveBeenCalledOnce();
    expect(restored.snapshot().pendingAlerts).toHaveLength(0);
    expect(restored.snapshot().records).toHaveLength(50);
  });
});
