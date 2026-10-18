import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { heartbeatSchema } from "./health.js";
import { formatLifecycleTime } from "./lifecycle.js";

const monitorConfigSchema = z.object({
  botToken: z.string().min(1), chatId: z.string().regex(/^-?[1-9]\d*$/),
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "Gunakan URL HTTP(S) tanpa kredensial pada URL."),
  token: z.string().min(32),
  pollIntervalSec: z.coerce.number().int().min(5).max(300).default(15),
  timeoutSec: z.coerce.number().int().min(60).max(3600).default(120),
  stateFile: z.string().min(1).default("data/bot-monitor.json")
}).refine((value) => value.timeoutSec > value.pollIntervalSec, { message: "Timeout harus lebih besar dari interval polling." });
export type MonitorConfig = z.infer<typeof monitorConfigSchema>;
export function loadMonitorConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  return monitorConfigSchema.parse({ botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_MONITOR_CHAT_ID || env.TELEGRAM_STARTUP_CHAT_ID,
    url: env.BOT_HEALTH_URL || "http://127.0.0.1:3101/health", token: env.BOT_HEALTH_TOKEN,
    pollIntervalSec: env.BOT_MONITOR_POLL_INTERVAL_SEC, timeoutSec: env.BOT_MONITOR_TIMEOUT_SEC,
    stateFile: env.BOT_MONITOR_STATE_FILE });
}

const stateSchema = z.object({
  version: z.literal(1), outageSince: z.number().finite().nullable(), lastHealthyAt: z.number().finite().nullable(),
  downNotified: z.boolean(),
  pending: z.object({ kind: z.enum(["down", "recovered"]), text: z.string().max(4000) }).nullable()
});
type MonitorState = z.infer<typeof stateSchema>;

export function heartbeatIsHealthy(input: unknown, now: number, timeoutSec: number): boolean {
  const parsed = heartbeatSchema.safeParse(input);
  if (!parsed.success || parsed.data.phase !== "online") return false;
  const heartbeatAt = parsed.data.lastTelegramPollAt ?? parsed.data.readyAt;
  if (!heartbeatAt) return false;
  const age = now - Date.parse(heartbeatAt);
  return age >= -30000 && age < timeoutSec * 1000;
}

export async function probeHeartbeat(config: MonitorConfig): Promise<unknown> {
  const response = await fetch(config.url, { headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("Health endpoint gagal atau menolak autentikasi.");
  return response.json();
}

// One monitor process per state file. Pending messages survive a restart.
export class HeartbeatMonitor {
  private state: MonitorState = { version: 1, outageSince: null, lastHealthyAt: null, downNotified: false, pending: null };
  constructor(private readonly file: string, private readonly timeoutSec: number) {}
  async init(): Promise<void> {
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("State monitor rusak/tidak terbaca; pulihkan backup.");
    }
  }
  snapshot(): MonitorState { return structuredClone(this.state); }
  private async save(next: MonitorState): Promise<void> {
    stateSchema.parse(next);
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = next;
  }
  async tick(heartbeat: unknown, send: (text: string) => Promise<void>, now = Date.now()): Promise<void> {
    const next = this.snapshot();
    const parsed = heartbeatSchema.safeParse(heartbeat);
    const stamp = parsed.success ? parsed.data.lastTelegramPollAt ?? parsed.data.readyAt : null;
    if (heartbeatIsHealthy(heartbeat, now, this.timeoutSec)) {
      next.lastHealthyAt = Date.parse(stamp!);
      next.outageSince = null;
      if (next.downNotified) {
        if (next.pending?.kind !== "recovered") next.pending = { kind: "recovered", text: [
          "TOKEN INTELLIGENCE | HEARTBEAT PULIH", "", "Polling Telegram kembali terhubung menurut monitor.",
          `Terverifikasi: ${formatLifecycleTime(now)}`, "Kesehatan GMGN dan pengiriman runner belum diverifikasi oleh heartbeat ini."
        ].join("\n") };
      } else next.pending = null;
    } else {
      next.outageSince ??= Math.min(now, next.lastHealthyAt ?? (stamp ? Date.parse(stamp) : now));
      if (next.pending?.kind === "recovered") next.pending = null;
      if (!next.downNotified && now - next.outageSince >= this.timeoutSec * 1000 && !next.pending) {
        next.pending = { kind: "down", text: ["TOKEN INTELLIGENCE | TIDAK TERHUBUNG", "",
          `Heartbeat sehat tidak diterima selama setidaknya ${this.timeoutSec} detik.`,
          "Bot mungkin berhenti, server tidak aktif, endpoint tidak dapat diakses, atau polling Telegram terganggu.",
          "Scan CA dan alert runner mungkin tidak tersedia.", "",
          `Terakhir terverifikasi sehat: ${next.lastHealthyAt === null ? "belum pernah" : formatLifecycleTime(next.lastHealthyAt)}`,
          `Terdeteksi: ${formatLifecycleTime(now)}`, "Perlu pemeriksaan proses, jaringan, dan server."
        ].join("\n") };
      }
    }
    await this.save(next);
    if (next.pending) {
      await send(next.pending.text);
      await this.save({ ...next, pending: null, downNotified: next.pending.kind === "down" });
    }
  }
}
