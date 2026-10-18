import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BotHealth, healthResponse } from "../../apps/telegram/src/health.js";
import { HeartbeatMonitor, heartbeatIsHealthy, loadMonitorConfig, probeHeartbeat } from "../../apps/telegram/src/heartbeat-monitor.js";
import { loadConfig } from "../../packages/shared/src/config.js";

const t = Date.parse("2026-10-18T10:00:00.000Z");
const token = "x".repeat(32);
async function setup() {
  const file = join(await mkdtemp(join(tmpdir(), "bot-monitor-")), "state.json");
  const monitor = new HeartbeatMonitor(file, 120);
  await monitor.init();
  return { file, monitor };
}
function online(now = t) { const health = new BotHealth(now); health.ready(now); health.pollSucceeded(now); return health.snapshot(); }

describe("independent bot heartbeat monitoring", () => {
  it("validates endpoint and monitor configuration without accepting missing secrets", () => {
    expect(() => loadConfig({ BOT_HEALTH_ENABLED: "true" })).toThrow("BOT_HEALTH_TOKEN");
    expect(loadConfig({ BOT_HEALTH_ENABLED: "true", BOT_HEALTH_TOKEN: token }).botHealthHost).toBe("127.0.0.1");
    expect(() => loadConfig({ BOT_SHUTDOWN_TIMEOUT_SEC: "1" })).toThrow();
    expect(() => loadMonitorConfig({})).toThrow();
    const env = { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_STARTUP_CHAT_ID: "123", BOT_HEALTH_TOKEN: token };
    expect(loadMonitorConfig(env).timeoutSec).toBe(120);
    expect(() => loadMonitorConfig({ ...env, BOT_HEALTH_URL: "file:///tmp/private" })).toThrow();
    expect(() => loadMonitorConfig({ ...env, BOT_HEALTH_URL: "http://user:password@host/health" })).toThrow();
    expect(() => loadMonitorConfig({ ...env, BOT_MONITOR_POLL_INTERVAL_SEC: "120" })).toThrow();
  });

  it("authenticates the health endpoint and exposes only lifecycle heartbeat data", () => {
    const health = new BotHealth(t);
    expect(healthResponse(health, token, undefined, "GET", "/health").status).toBe(401);
    expect(healthResponse(health, token, "Bearer wrong", "GET", "/health").status).toBe(401);
    expect(healthResponse(health, token, `Bearer ${token}`, "POST", "/health").status).toBe(405);
    expect(healthResponse(health, token, `Bearer ${token}`, "GET", "/other").status).toBe(404);
    const response = healthResponse(health, token, `Bearer ${token}`, "GET", "/health");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(heartbeatIsHealthy(response.body, t, 120)).toBe(false);
    health.ready(t);
    expect(heartbeatIsHealthy(health.snapshot(), t, 120)).toBe(true);
    health.pollSucceeded(t + 30000);
    expect(heartbeatIsHealthy(health.snapshot(), t + 149999, 120)).toBe(true);
    expect(heartbeatIsHealthy(health.snapshot(), t + 150000, 120)).toBe(false);
    health.stopping();
    health.pollSucceeded(t + 160000);
    expect(health.snapshot().lastTelegramPollAt).toBe(new Date(t + 30000).toISOString());
    expect(heartbeatIsHealthy(health.snapshot(), t + 30000, 120)).toBe(false);
    expect(heartbeatIsHealthy(online(t + 60000), t, 120)).toBe(false);
  });

  it("waits for the threshold, alerts once, survives restart and reports recovery once", async () => {
    const { file, monitor } = await setup();
    const send = vi.fn(async (_text: string) => undefined);
    await monitor.tick(online(), send, t);
    await monitor.tick(undefined, send, t + 15000);
    await monitor.tick(undefined, send, t + 119999);
    expect(send).not.toHaveBeenCalled();
    await monitor.tick(undefined, send, t + 120000);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain("TIDAK TERHUBUNG");
    const restored = new HeartbeatMonitor(file, 120);
    await restored.init();
    await restored.tick(undefined, send, t + 240000);
    expect(send).toHaveBeenCalledOnce();
    await restored.tick(online(t + 250000), send, t + 250000);
    await restored.tick(online(t + 260000), send, t + 260000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain("HEARTBEAT PULIH");
  });

  it("detects a stalled polling heartbeat without waiting twice the timeout", async () => {
    const { monitor } = await setup();
    const send = vi.fn(async () => undefined);
    await monitor.tick(online(), send, t);
    await monitor.tick(online(), send, t + 120000);
    expect(send).toHaveBeenCalledOnce();
  });

  it("allows first-start grace and cancels stale unsent down alerts after recovery", async () => {
    const { monitor } = await setup();
    const send = vi.fn(async (_text: string) => { throw new Error("offline"); });
    await monitor.tick(undefined, send, t);
    expect(send).not.toHaveBeenCalled();
    await expect(monitor.tick(undefined, send, t + 120000)).rejects.toThrow("offline");
    expect(monitor.snapshot().pending?.kind).toBe("down");
    await monitor.tick(online(t + 121000), send, t + 121000);
    expect(monitor.snapshot().pending).toBeNull();
    expect(send).toHaveBeenCalledOnce();
  });

  it("retries persisted delivery failures after restart without losing the alert", async () => {
    const { file, monitor } = await setup();
    await monitor.tick(undefined, async () => undefined, t);
    await expect(monitor.tick(undefined, async () => { throw new Error("offline"); }, t + 120000)).rejects.toThrow();
    const restored = new HeartbeatMonitor(file, 120);
    await restored.init();
    const send = vi.fn(async () => undefined);
    await restored.tick(undefined, send, t + 130000);
    await restored.tick(undefined, send, t + 140000);
    expect(send).toHaveBeenCalledOnce();
    expect(restored.snapshot().pending).toBeNull();
  });

  it("never overwrites corrupt monitor state", async () => {
    const { file } = await setup();
    await writeFile(file, "broken");
    await expect(new HeartbeatMonitor(file, 120).init()).rejects.toThrow("rusak");
  });

  it("sends auth only as a header and refuses redirects", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => online() }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const config = loadMonitorConfig({ TELEGRAM_BOT_TOKEN: "test", TELEGRAM_MONITOR_CHAT_ID: "123", BOT_HEALTH_TOKEN: token });
      await probeHeartbeat(config);
      expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3101/health", expect.objectContaining({
        headers: { authorization: `Bearer ${token}` }, redirect: "error"
      }));
    } finally { vi.unstubAllGlobals(); }
  });
});
