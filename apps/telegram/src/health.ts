import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "@sti/shared";

export const heartbeatSchema = z.object({
  version: z.literal(1), phase: z.enum(["starting", "online", "stopping"]),
  startedAt: z.string().datetime(), readyAt: z.string().datetime().nullable(),
  lastTelegramPollAt: z.string().datetime().nullable()
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

export class BotHealth {
  private state: Heartbeat;
  constructor(now = Date.now()) {
    this.state = { version: 1, phase: "starting", startedAt: new Date(now).toISOString(), readyAt: null, lastTelegramPollAt: null };
  }
  ready(now = Date.now()): void {
    this.state.phase = "online";
    this.state.readyAt = new Date(now).toISOString();
  }
  pollSucceeded(now = Date.now()): void {
    if (this.state.phase === "online") this.state.lastTelegramPollAt = new Date(now).toISOString();
  }
  stopping(): void { this.state.phase = "stopping"; }
  snapshot(): Heartbeat { return { ...this.state }; }
}

export function healthResponse(health: BotHealth, token: string, authorization: string | undefined, method: string | undefined, path: string | undefined) {
  const actual = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, body: { error: "Unauthorized" } };
  if (path !== "/health") return { status: 404, body: { error: "Not found" } };
  if (method !== "GET") return { status: 405, body: { error: "Method not allowed" } };
  return { status: 200, body: health.snapshot() };
}

export async function startHealthServer(health: BotHealth, config: AppConfig): Promise<() => Promise<void>> {
  if (!config.botHealthEnabled) return async () => undefined;
  const server = createServer((req, res) => {
    const result = healthResponse(health, config.botHealthToken!, req.headers.authorization, req.method, req.url);
    res.writeHead(result.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.botHealthPort, config.botHealthHost, () => { server.off("error", reject); resolve(); });
  });
  return () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
