import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assessRunner, RunnerMonitor, formatRunnerRecord } from "../../packages/analysis/src/runner.js";
import { live, mint } from "./live-fixtures.js";

async function setup(enabled = true) {
  const file = join(await mkdtemp(join(tmpdir(), "runner-test-")), "state.json");
  const adapter = { getTokenSnapshot: vi.fn(async () => live()), discoverTokens: vi.fn(async () => [mint]) };
  const monitor = new RunnerMonitor(adapter, file, enabled);
  await monitor.init();
  return { monitor, file, adapter };
}

describe("runner detection and persistence", () => {
  it("requires live inputs, liquidity, trading activity and known risk data", () => {
    expect(assessRunner(live()).candidate).toBe(true);
    for (const overrides of [
      { source: "fixture" as const }, { top10HolderPct: null }, { insiderPct: 50 }, { liquidityUsd: 500 },
      { buys1h: 1, sells1h: 0 }, { top10HolderPct: 70 }, { priceChange1hPct: -20 },
      { dataWarnings: ["Provider menandai honeypot."] }
    ]) expect(assessRunner({ ...live(), ...overrides }).candidate).toBe(false);
    expect(assessRunner({ ...live(), insiderPct: null }).reasons.join(" ")).toContain("risiko belum dapat dinilai");
  });

  it("records the first detection once, sampled milestones and drawdown across restarts", async () => {
    const { monitor, file, adapter } = await setup();
    const base = live();
    const time = Date.now();
    await monitor.observe({ ...base, priceUsd: 1, observedAt: new Date(time).toISOString() });
    await monitor.observe({ ...base, priceUsd: 2.5, observedAt: new Date(time + 1000).toISOString() });
    await monitor.observe({ ...base, priceUsd: 5, observedAt: new Date(time + 2000).toISOString() });
    await monitor.observe({ ...base, priceUsd: 2, observedAt: new Date(time + 3000).toISOString(), priceChange1hPct: -20 });
    await monitor.observe({ ...base, priceUsd: 100, observedAt: new Date(time + 2000).toISOString() });
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    const record = restored.snapshot().records[0];
    expect(record.initialPrice).toBe(1);
    expect(record.latestPrice).toBe(2);
    expect(record.peakPrice).toBe(5);
    expect(record.maxDrawdownPct).toBe(-60);
    expect(record.reached2xAt).not.toBeNull();
    expect(record.reached5xAt).not.toBeNull();
    expect(record.observations).toBe(4);
    expect(record.candidate).toBe(false);
    expect(formatRunnerRecord(record, time + 20 * 60_000)).toContain("DATA LAMA");
  });

  it("runs discovery, persists a cycle and does not scan while paused", async () => {
    const { monitor, adapter } = await setup();
    await monitor.cycle();
    expect(monitor.snapshot().records).toHaveLength(1);
    expect(monitor.snapshot().lastCycleAt).not.toBeNull();
    await monitor.pause(true);
    await monitor.cycle();
    expect(adapter.discoverTokens).toHaveBeenCalledTimes(1);
    await monitor.pause(false);
    expect(monitor.active).toBe(true);
    await monitor.remove(mint);
    expect(monitor.snapshot().records).toHaveLength(0);
  });

  it("does not treat a provider error as a new observation", async () => {
    const { monitor, adapter } = await setup();
    await monitor.cycle();
    const previous = monitor.snapshot().records[0];
    adapter.getTokenSnapshot.mockRejectedValueOnce(new Error("offline"));
    await monitor.cycle();
    expect(monitor.snapshot().records[0]).toEqual(previous);
    expect(monitor.snapshot().lastError).not.toBeNull();
  });

  it("still refreshes existing candidates when discovery fails", async () => {
    const { monitor, adapter } = await setup();
    await monitor.observe({ ...live(), observedAt: new Date(Date.now() - 10_000).toISOString() });
    adapter.discoverTokens.mockRejectedValueOnce(new Error("discovery unavailable"));
    await monitor.cycle();
    expect(monitor.snapshot().records[0].observations).toBe(2);
    expect(monitor.snapshot().lastError).not.toBeNull();
    monitor.stop();
    await monitor.cycle();
    expect(adapter.discoverTokens).toHaveBeenCalledTimes(1);
  });

  it("honors a pause queued before an observation", async () => {
    const { monitor } = await setup();
    await Promise.all([monitor.pause(true), monitor.observe(live())]);
    expect(monitor.snapshot().records).toHaveLength(0);
    expect(monitor.active).toBe(false);
  });

  it("serializes concurrent writes without losing detections", async () => {
    const { monitor } = await setup();
    const base = live();
    await Promise.all([monitor.observe(base), monitor.observe({ ...base, mint: "7UAWdJjrBykopzco6bCBmMLdggaiec6bd4bTKmQqpump" })]);
    expect(monitor.snapshot().records).toHaveLength(2);
  });

  it("never overwrites corrupt state and never records demo or disabled monitoring", async () => {
    const { monitor, file, adapter } = await setup(false);
    await monitor.observe(live());
    expect(monitor.snapshot().records).toHaveLength(0);
    await expect(monitor.pause(false)).rejects.toThrow("RUNNER_ENABLED");
    await writeFile(file, "broken");
    await expect(new RunnerMonitor(adapter, file, true).init()).rejects.toThrow("rusak");
    expect(await readFile(file, "utf8")).toBe("broken");
  });
});
