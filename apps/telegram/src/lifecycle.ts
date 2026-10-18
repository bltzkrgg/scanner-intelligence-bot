import type { Bot } from "grammy";
import { CHAIN_NAMES, type AppConfig, type Chain } from "@sti/shared";
import { alertsEnabled, alertInterval, formatRunnerNotification, type RunnerMonitor } from "@sti/analysis";

export function statusMessage(config: AppConfig, runner?: RunnerMonitor): string {
  return [
    "TOKEN INTELLIGENCE",
    "Status: proses bot aktif",
    `Jaringan: ${config.enabledChains.map((chain) => CHAIN_NAMES[chain]).join(", ")}`,
    config.gmgnProvider === "mock"
      ? "Mode data: MOCK / data contoh, bukan data pasar aktual."
      : "Mode data: GMGN CLI / koneksi provider belum diverifikasi oleh status ini.",
    "",
    "Kirim CA langsung. Alamat 0x akan meminta pilihan BSC atau RH.",
    "Menu: /start, /scan, /help, /status, /chatid, /runner, /runners.",
    `Runner: ${runner?.active ? "AKTIF" : "NONAKTIF"}. Interval Solana/BSC/RH: /getconfig.`,
    `Notifikasi runner: ${config.telegramRunnerChatId ? "tujuan chat dikonfigurasi" : "NONAKTIF; isi TELEGRAM_RUNNER_CHAT_ID"}. Antrean: ${runner?.snapshot().pendingAlerts.length ?? 0}.`,
    runner?.snapshot().lastNotificationError ?? "",
    "Smart wallet bank sendiri dan Discord belum aktif."
  ].join("\n");
}

export function registerUtilityCommands(bot: Bot, config: AppConfig, runner?: RunnerMonitor): void {
  bot.command("help", async (ctx) => {
    await ctx.reply("Kirim CA langsung atau /scan <CA>. Untuk EVM pilih tombol BSC/RH, atau /scan bsc <CA> dan /scan rh <CA>.\n/runner [sol|bsc|rh] <CA>: evaluasi runner dan histori.\n/runners: daftar dan status pemantauan.\n/runner_on, /runner_off, /runner_remove <chain> <CA>, /runner_test: khusus admin.\n/getconfig, /setconfig <key> <value>: admin, filter alert Solana/BSC/RH tanpa restart.\n/status: mode data dan notifikasi.\n/chatid: ID chat dan user untuk konfigurasi.");
  });
  bot.command("status", async (ctx) => { await ctx.reply(statusMessage(config, runner)); });
  bot.command("chatid", async (ctx) => { await ctx.reply(`Chat ID: ${ctx.chat.id}\nUser ID: ${ctx.from?.id ?? "tidak tersedia"}`); });
}

export async function configureTelegramMenu(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Mulai menggunakan bot" },
    { command: "scan", description: "Analisis CA Solana, BSC, atau RH" },
    { command: "help", description: "Panduan penggunaan" },
    { command: "status", description: "Status bot dan mode data" },
    { command: "chatid", description: "ID chat dan user untuk konfigurasi" },
    { command: "runner", description: "Cek runner: /runner CA" },
    { command: "runners", description: "Daftar kandidat dan histori runner" },
    { command: "runner_on", description: "Admin: lanjutkan pemantauan runner" },
    { command: "runner_off", description: "Admin: jeda pemantauan runner" },
    { command: "runner_remove", description: "Admin: hapus histori satu CA" },
    { command: "runner_test", description: "Admin: uji kirim notifikasi runner" },
    { command: "getconfig", description: "Admin: lihat pengaturan alert" },
    { command: "setconfig", description: "Admin: ubah pengaturan alert" }
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

export async function sendRunnerNotifications(bot: Bot, runner: RunnerMonitor, config: AppConfig, chains?: Chain[]): Promise<void> {
  if (!config.telegramRunnerChatId) return;
  let nextSendAt = 0;
  await runner.deliverNotifications(async (event) => {
    const delay = nextSendAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!runner.active) throw new Error("Runner stopped");
    await bot.api.sendMessage(config.telegramRunnerChatId!, formatRunnerNotification(event));
    nextSendAt = Date.now() + 1100;
  }, chains);
}

export function formatStartupNotification(config: AppConfig, runner?: RunnerMonitor, now = Date.now()): string {
  const state = runner?.snapshot();
  return ["TOKEN INTELLIGENCE | ONLINE", "", "Bot mulai berjalan dan siap menerima CA.", "",
    `Jaringan: ${config.enabledChains.map((chain) => CHAIN_NAMES[chain]).join(" | ")}`,
    config.gmgnProvider === "cli" ? "Mode data: GMGN Live" : "Mode data: MOCK / data contoh, bukan data pasar aktual.",
    `Runner: ${runner?.active ? "Aktif" : "Nonaktif"}`, "Alert jaringan:",
    ...config.enabledChains.map((chain) => `${CHAIN_NAMES[chain]}: ${runner?.active && state && alertsEnabled(state.alertConfig, chain) ? "Aktif" : "Nonaktif"}${state ? ` | polling ${alertInterval(state.alertConfig, chain)} detik` : ""}`),
    `Tujuan alert runner: ${config.telegramRunnerChatId ? "dikonfigurasi" : "BELUM DIISI; alert runner tidak dikirim"}`,
    "", `Waktu mulai: ${formatLifecycleTime(now)}`, "",
    "Status proses aktif. Koneksi GMGN belum diverifikasi sebelum query berhasil."
  ].join("\n");
}

export function formatLifecycleTime(now: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" }).format(now) + " WIB";
}

export function formatShutdownNotification(reason: string, startedAt: number, saved: boolean, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60000);
  return ["TOKEN INTELLIGENCE | OFFLINE", "", "Proses bot sedang dihentikan.",
    "Scan CA, pemantauan runner, dan pengiriman alert tidak tersedia selama bot berhenti.", "",
    `Alasan: ${reason}`, `Uptime: ${Math.floor(minutes / 60)} jam ${minutes % 60} menit`,
    `Waktu berhenti: ${formatLifecycleTime(now)}`, "",
    saved ? "Status penyimpanan: snapshot state terakhir berhasil disimpan. Observasi yang sebelumnya gagal tidak dipulihkan."
      : "Status penyimpanan: checkpoint terakhir GAGAL; periksa log dan file state."
  ].join("\n");
}

export async function sendShutdownNotification(bot: Bot, config: AppConfig, reason: string, startedAt: number, saved: boolean): Promise<void> {
  if (!config.telegramStartupChatId) return;
  await sendStatusMessage(bot, config.telegramStartupChatId, formatShutdownNotification(reason, startedAt, saved));
}

export async function sendStatusMessage(bot: Bot, chatId: string, text: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // grammY's Node polyfill typings differ from the native, compatible signal.
    const signal = controller.signal as unknown as NonNullable<Parameters<typeof bot.api.sendMessage>[3]>;
    await bot.api.sendMessage(chatId, text, {}, signal);
  } finally { clearTimeout(timer); }
}

export async function sendStartupNotification(bot: Bot, config: AppConfig, runner?: RunnerMonitor): Promise<void> {
  if (!config.telegramStartupChatId) return;
  await sendStatusMessage(bot,
    config.telegramStartupChatId,
    formatStartupNotification(config, runner)
  );
}
