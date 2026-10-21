import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { formatRunnerRecord, type IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import { CHAIN_NAMES, normalizeAddress, type AppConfig, type Chain } from "@sti/shared";
import { sendLifecycleTest, statusMessage } from "../lifecycle.js";
import { scanInput } from "./scan.js";
import { runnerInput } from "./runner.js";
import { CONFIG_FIELDS, configValue, displayConfigValue, type ConfigGroup } from "./config-fields.js";

type Token = { chain: Chain; mint: string };
type Pending = { kind: "config"; field: number } | { kind: "scan" | "runner" | "remove"; chain: Chain };
type Confirmation = { nonce: string; kind: "pause" | "resume" } | { nonce: string; kind: "remove"; token: Token };
type ConfirmationInput = { kind: "pause" | "resume" } | { kind: "remove"; token: Token };
type Session = { id: string; owner: number; chat: number; message: number; expires: number; tokens: Token[];
  pending?: Pending; confirmation?: Confirmation; busy: boolean };
const TTL = 10 * 60000;
const GROUPS: Record<ConfigGroup, string> = { general: "Alert Jaringan", new: "Kandidat Baru",
  old: "Volume Token Lama", spike: "Spike Legacy", delivery: "Polling & Pengiriman" };

export function registerTelegramMenus(bot: Bot, runner: RunnerMonitor, scanner: IntelligenceScanner, config: AppConfig): void {
  const sessions = new Map<string, Session>();
  const waiting = new Map<string, string>();
  const key = (chat: number, owner: number) => `${chat}:${owner}`;
  const admin = (ctx: Context) => !!ctx.from && config.telegramAdminIds.includes(String(ctx.from.id));
  const chainOf = (value: string): Chain => {
    if (value !== "sol" && value !== "bsc" && value !== "robinhood") throw new Error("Jaringan tidak valid.");
    return value;
  };
  function clearPending(s: Session): void {
    if (waiting.get(key(s.chat, s.owner)) === s.id) waiting.delete(key(s.chat, s.owner));
    delete s.pending;
  }
  function prune(): void {
    for (const s of sessions.values()) if (s.expires <= Date.now()) { clearPending(s); sessions.delete(s.id); }
    if (sessions.size >= 500) {
      const first = sessions.values().next().value!;
      clearPending(first); sessions.delete(first.id);
    }
  }
  function keyboard(s: Session, rows: Array<Array<[string, string]>>): InlineKeyboard {
    const result = new InlineKeyboard();
    rows.forEach((row, index) => {
      if (index) result.row();
      for (const [label, action] of row) result.text(label, `ui:${s.id}:${action}`);
    });
    return result;
  }
  async function show(ctx: Context, s: Session, text: string, markup: InlineKeyboard): Promise<void> {
    s.expires = Date.now() + TTL;
    if (!s.message) {
      const message = await ctx.reply(text, { reply_markup: markup });
      s.message = message.message_id;
    } else {
      try { await ctx.api.editMessageText(s.chat, s.message, text, { reply_markup: markup }); }
      catch (error) { if (!(error instanceof Error && /message is not modified/i.test(error.message))) throw error; }
    }
  }
  async function prompt(ctx: Context, s: Session, pending: Pending, text: string): Promise<void> {
    const previous = sessions.get(waiting.get(key(s.chat, s.owner)) ?? "");
    if (previous) clearPending(previous);
    s.pending = pending;
    waiting.set(key(s.chat, s.owner), s.id);
    await show(ctx, s, text, keyboard(s, [[["Batal", "home"]]]));
  }
  async function confirm(ctx: Context, s: Session, action: ConfirmationInput, text: string): Promise<void> {
    const nonce = randomBytes(3).toString("hex");
    s.confirmation = { ...action, nonce } as Confirmation;
    await show(ctx, s, text, keyboard(s, [[["Konfirmasi", `confirm:${nonce}`], ["Batal", "home"]]]));
  }
  async function route(ctx: Context, s: Session, action: string, notice = ""): Promise<void> {
    const [page, a, b] = action.split(":");
    if (["cfg", "chain", "group", "field", "value", "custom", "all", "admin", "pause", "resume", "test", "remove", "confirm"].includes(page)
      && !admin(ctx)) throw new Error("Menu ini khusus admin.");
    const waitingSession = sessions.get(waiting.get(key(s.chat, s.owner)) ?? "");
    if (waitingSession) clearPending(waitingSession);
    clearPending(s);
    if (page !== "confirm") delete s.confirmation;
    const tail: Array<[string, string]> = [["Menu Utama", "home"]];
    if (page === "home") {
      await show(ctx, s, "TOKEN INTELLIGENCE\nSolana | BSC | Robinhood Chain", keyboard(s, [
        [["Scan Token", "scan"], ["Daftar Runner", "list:all:1"]],
        [["Status Bot", "status"], ["Bantuan", "help"]],
        ...(admin(ctx) ? [[["Pengaturan", "cfg"], ["Panel Admin", "admin"]] as Array<[string, string]>] : [])
      ]));
    } else if (page === "cfg") {
      await show(ctx, s, "PENGATURAN RUNNER\nPilih jaringan.", keyboard(s, [
        [["Solana", "chain:sol"], ["BSC", "chain:bsc"], ["Robinhood", "chain:robinhood"]], tail
      ]));
    } else if (page === "chain") {
      const chain = chainOf(a);
      const enabled = CONFIG_FIELDS.findIndex((f) => f.chain === chain && f.group === "general");
      await show(ctx, s, `PENGATURAN ${CHAIN_NAMES[chain]}\n${config.enabledChains.includes(chain) ? "" : "Jaringan belum diaktifkan di ENABLED_CHAINS.\n"}`,
        keyboard(s, [
          [[`Alert Jaringan: ${displayConfigValue(configValue(runner.snapshot().alertConfig, CONFIG_FIELDS[enabled]), CONFIG_FIELDS[enabled])}`, `field:${enabled}`]],
          [["Kandidat Baru", `group:${chain}:new`], [chain === "robinhood" ? "Volume / Spike Token Lama" : "Volume Token Lama", `group:${chain}:old`]],
          ...(chain !== "robinhood" ? [[["Spike Legacy", `group:${chain}:spike`]] as Array<[string, string]>] : []),
          [["Polling & Pengiriman", `group:${chain}:delivery`]], [["Lihat Semua Nilai", `all:${chain}`]], [["Kembali", "cfg"]]
        ]));
    } else if (page === "group") {
      const chain = chainOf(a);
      const group = b as ConfigGroup;
      const fields = CONFIG_FIELDS.map((f, index) => ({ ...f, index })).filter((f) => f.chain === chain && f.group === group);
      if (!fields.length) throw new Error("Pengaturan tidak tersedia untuk jaringan ini.");
      const settings = runner.snapshot().alertConfig;
      await show(ctx, s, `${CHAIN_NAMES[chain]} | ${GROUPS[group]}${group === "spike" ? "\nVolume, MC mengikuti Kandidat Baru; fees diatur terpisah." : ""}`,
        keyboard(s, [...fields.map((f): Array<[string, string]> => [[`${f.label}: ${displayConfigValue(configValue(settings, f), f)}`, `field:${f.index}`]]),
          [["Kembali", `chain:${chain}`]]]));
    } else if (["field", "value", "custom"].includes(page)) {
      const index = Number(a);
      const field = CONFIG_FIELDS[index];
      if (!Number.isInteger(index) || !field) throw new Error("Pengaturan tidak valid.");
      if (page === "value") {
        const preset = field.presets[Number(b)];
        if (preset === undefined || !/^\d+$/.test(b)) throw new Error("Nilai tidak valid.");
        await runner.setConfig(field.path, preset);
        return route(ctx, s, `field:${index}`, "Tersimpan. Berlaku pada pengecekan berikutnya.\n");
      }
      if (page === "custom") return prompt(ctx, s, { kind: "config", field: index },
        `${CHAIN_NAMES[field.chain]} | ${field.label}\nKirim nilai angka${field.unit ? ` (${field.unit})` : ""}.\nBerlaku untuk user dan chat ini selama 10 menit.`);
      const value = configValue(runner.snapshot().alertConfig, field);
      const presets = field.presets.map((preset, n): [string, string] => [displayConfigValue(preset === "true" ? true : preset === "false" ? false : Number(preset), field), `value:${index}:${n}`]);
      await show(ctx, s, `${notice}${CHAIN_NAMES[field.chain]} | ${GROUPS[field.group]}\n${field.label}\nSaat ini: ${displayConfigValue(value, field)}`
        + (field.label === "Minimum total fees" ? "\nTotal fees GMGN, bukan fees 5m. Nilai 0 menonaktifkan filter." : ""), keyboard(s, [presets,
          ...(typeof value === "number" ? [[["Nilai Lain", `custom:${index}`]] as Array<[string, string]>] : []),
          [["Kembali", field.group === "general" ? `chain:${field.chain}` : `group:${field.chain}:${field.group}`]]]));
    } else if (page === "all") {
      const chain = chainOf(a);
      const settings = runner.snapshot().alertConfig;
      await show(ctx, s, [`PENGATURAN ${CHAIN_NAMES[chain]}`, ...CONFIG_FIELDS.filter((f) => f.chain === chain)
        .map((f) => `${f.path}: ${configValue(settings, f)}`)].join("\n"), keyboard(s, [[["Kembali", `chain:${chain}`]]]));
    } else if (page === "status") {
      await show(ctx, s, statusMessage(config, runner), keyboard(s, [
        [["Perbarui", "status"], ["Daftar Runner", "list:all:1"]], ...(admin(ctx) ? [[["Pengaturan", "cfg"]] as Array<[string, string]>] : []), tail]));
    } else if (page === "help") {
      await show(ctx, s, "BANTUAN\nKirim CA langsung atau pilih Scan Token.\nAlamat 0x memerlukan pilihan BSC/RH.\nRunner menampilkan histori pengamatan, bukan rekomendasi beli.\nPengaturan dan kontrol worker khusus admin.",
        keyboard(s, [[["Scan Token", "scan"], ["Daftar Runner", "list:all:1"]],
          ...(admin(ctx) ? [[["Pengaturan", "cfg"]] as Array<[string, string]>] : []), tail]));
    } else if (page === "ids") {
      const markup = new InlineKeyboard().copyText("Salin Chat ID", String(s.chat)).copyText("Salin User ID", String(s.owner)).row()
        .text("Menu Utama", `ui:${s.id}:home`);
      await show(ctx, s, `Chat ID: ${s.chat}\nUser ID: ${s.owner}`, markup);
    } else if (page === "list") {
      const chain = a === "all" ? null : chainOf(a);
      const records = runner.snapshot().records.filter((r) => !chain || r.chain === chain).sort((x, y) => y.lastSeenAt.localeCompare(x.lastSeenAt));
      const pages = Math.max(1, Math.ceil(records.length / 4));
      const current = Math.min(pages, Math.max(1, Number(b) || 1));
      const visible = records.slice((current - 1) * 4, current * 4);
      const rows: Array<Array<[string, string]>> = [[ ["Semua", "list:all:1"], ...config.enabledChains.map((c): [string, string] => [CHAIN_NAMES[c], `list:${c}:1`]) ]];
      for (const r of visible) {
        let index = s.tokens.findIndex((t) => t.chain === r.chain && t.mint === r.mint);
        if (index < 0) { index = s.tokens.length; s.tokens.push({ chain: r.chain, mint: r.mint }); }
        rows.push([[`${r.symbol.replace(/[\r\n\t]+/g, " ").slice(0, 30)} | ${CHAIN_NAMES[r.chain]}`, `token:${index}`]]);
      }
      rows.push([...(current > 1 ? [["Sebelumnya", `list:${a}:${current - 1}`] as [string, string]] : []),
        ...(current < pages ? [["Berikutnya", `list:${a}:${current + 1}`] as [string, string]] : [])]);
      rows.push([["Perbarui", `list:${a}:${current}`]], tail);
      await show(ctx, s, `DAFTAR RUNNER | ${runner.active ? "AKTIF" : "NONAKTIF"}\n${records.length} token | Halaman ${current}/${pages}\n`
        + (visible.length ? "Pilih token untuk detail." : "Belum ada token tersimpan."), keyboard(s, rows.filter((row) => row.length)));
    } else if (page === "token" || page === "delete") {
      if (page === "delete" && !admin(ctx)) throw new Error("Menu ini khusus admin.");
      const token = s.tokens[Number(a)];
      if (!token || !/^\d+$/.test(a)) throw new Error("Token tidak valid.");
      if (page === "delete") return confirm(ctx, s, { kind: "remove", token }, `HAPUS HISTORI\n${CHAIN_NAMES[token.chain]}\n${token.mint}\nHistori, antrean, dan baseline token akan dihapus. Discovery dapat mendeteksinya lagi.`);
      const record = runner.snapshot().records.find((r) => r.chain === token.chain && r.mint === token.mint);
      if (!record) throw new Error("Histori token sudah tidak tersedia.");
      const markup = new InlineKeyboard().url("GMGN", `https://gmgn.ai/${token.chain}/token/${token.mint}`).copyText("Salin CA", token.mint).row();
      if (admin(ctx)) markup.text("Hapus Histori", `ui:${s.id}:delete:${a}`).row();
      markup.text("Kembali", `ui:${s.id}:list:${token.chain}:1`);
      await show(ctx, s, formatRunnerRecord(record).slice(0, 3800), markup);
    } else if (page === "scan" || page === "runner" || page === "remove") {
      if (!a) return show(ctx, s, page === "remove" ? "HAPUS HISTORI\nPilih jaringan, lalu kirim CA." : "Pilih jaringan, lalu kirim CA.",
        keyboard(s, [config.enabledChains.map((c): [string, string] => [CHAIN_NAMES[c], `${page}:${c}`]), tail]));
      const chain = chainOf(a);
      if (!config.enabledChains.includes(chain)) throw new Error("Jaringan belum aktif.");
      await prompt(ctx, s, { kind: page, chain }, `${CHAIN_NAMES[chain]}\nKirim CA untuk ${page === "remove" ? "menghapus histori" : page === "scan" ? "scan token" : "detail runner"}.\nPermintaan berlaku 10 menit.`);
    } else if (page === "admin") {
      await show(ctx, s, `PANEL ADMIN\nRunner: ${runner.active ? "AKTIF" : "NONAKTIF"}`, keyboard(s, [
        [["Lanjutkan Runner", "resume"], ["Jeda Runner", "pause"]], [["Tes Alert Runner", "test:runner"]],
        [["Tes Online/Offline", "test:life"]], [["Hapus Histori Token", "remove"]], [["Pengaturan", "cfg"]], tail]));
    } else if (page === "pause" || page === "resume") {
      await confirm(ctx, s, { kind: page }, page === "pause" ? "Jeda seluruh pemantauan dan pengiriman runner? Histori tetap tersimpan."
        : "Lanjutkan pemantauan runner? RUNNER_ENABLED dan provider live tetap diperlukan.");
    } else if (page === "confirm") {
      const confirmation = s.confirmation;
      if (!confirmation || confirmation.nonce !== a) throw new Error("Konfirmasi kedaluwarsa. Buka menu lagi.");
      delete s.confirmation;
      if (confirmation.kind === "remove") await runner.remove(confirmation.token.mint, confirmation.token.chain);
      else await runner.pause(confirmation.kind === "pause");
      await show(ctx, s, confirmation.kind === "remove" ? "Histori token dihapus. Discovery dapat mendeteksinya lagi." : "Status runner tersimpan.",
        keyboard(s, [[["Panel Admin", "admin"]], tail]));
    } else if (page === "test") {
      if (a === "runner") {
        if (!config.telegramRunnerChatId) throw new Error("TELEGRAM_RUNNER_CHAT_ID belum dikonfigurasi.");
        await bot.api.sendMessage(config.telegramRunnerChatId, "TES NOTIFIKASI TOKEN RUNNER\nIni pesan uji, bukan deteksi pasar.");
      } else if (a === "life") {
        if (!await sendLifecycleTest(bot, config)) throw new Error("TELEGRAM_STARTUP_CHAT_ID belum dikonfigurasi.");
      } else throw new Error("Tes tidak valid.");
      await show(ctx, s, "Pesan uji terkirim ke tujuan yang dikonfigurasi.", keyboard(s, [[["Panel Admin", "admin"]], tail]));
    } else throw new Error("Menu tidak dikenal.");
  }

  bot.on("message:text", async (ctx, next) => {
    const owner = ctx.from.id;
    const id = waiting.get(key(ctx.chat.id, owner));
    const s = sessions.get(id ?? "");
    if (!s?.pending) return next();
    if (s.expires <= Date.now()) { clearPending(s); sessions.delete(s.id); await ctx.reply("Input menu kedaluwarsa. Buka menu lagi."); return; }
    if (ctx.message.text.startsWith("/")) { clearPending(s); return next(); }
    if (s.busy) { await ctx.reply("Permintaan sebelumnya masih diproses."); return; }
    s.busy = true;
    try {
      const pending = s.pending;
      if ((pending.kind === "config" || pending.kind === "remove") && !admin(ctx)) {
        clearPending(s); await ctx.reply("Menu ini khusus admin."); return;
      }
      if (pending.kind === "config") {
        const field = CONFIG_FIELDS[pending.field];
        try { await runner.setConfig(field.path, ctx.message.text.trim()); }
        catch (error) {
          await ctx.reply(error instanceof Error && error.message.startsWith(field.path) ? error.message : "Gagal menyimpan. Periksa nilai dan izin file state. Coba lagi atau Batal."); return;
        }
        await route(ctx, s, `field:${pending.field}`, "Tersimpan.\n");
      } else {
        let mint: string;
        try { mint = normalizeAddress(ctx.message.text.trim(), pending.chain); }
        catch { await ctx.reply("CA tidak valid untuk jaringan yang dipilih. Coba lagi atau Batal."); return; }
        clearPending(s);
        if (pending.kind === "remove") await confirm(ctx, s, { kind: "remove", token: { chain: pending.chain, mint } },
          `Hapus histori, antrean, dan baseline ${CHAIN_NAMES[pending.chain]} untuk CA ini?\n${mint}`);
        else {
          await show(ctx, s, "CA diterima. Mengambil data token...", keyboard(s, [[["Menu Utama", "home"]]]));
          if (pending.kind === "scan") await scanInput(ctx, `${pending.chain} ${mint}`, scanner, runner);
          else await runnerInput(ctx, `${pending.chain} ${mint}`, runner, scanner);
        }
      }
    } finally { s.busy = false; }
  });

  bot.callbackQuery(/^ui:([a-f0-9]{12}):(.+)$/, async (ctx) => {
    const s = sessions.get(ctx.match[1]);
    if (!s || s.expires <= Date.now() || ctx.from.id !== s.owner || ctx.chat?.id !== s.chat
      || ctx.callbackQuery.message?.message_id !== s.message) {
      await ctx.answerCallbackQuery({ text: "Menu bukan milikmu atau sudah kedaluwarsa. Buka command sendiri.", show_alert: true }); return;
    }
    if (s.busy) { await ctx.answerCallbackQuery({ text: "Permintaan masih diproses." }); return; }
    s.busy = true;
    try { await ctx.answerCallbackQuery(); await route(ctx, s, ctx.match[2]); }
    catch { await ctx.reply("Menu tidak dapat diproses. Periksa izin admin, konfigurasi, atau buka command kembali."); }
    finally { s.busy = false; }
  });

  const commands: Record<string, string> = { start: "home", help: "help", status: "status", chatid: "ids", scan: "scan", runner: "runner",
    runners: "list:all:1", getconfig: "cfg", setconfig: "cfg", runner_on: "resume", runner_off: "pause", runner_remove: "remove",
    runner_test: "test:runner", notification_test: "test:life" };
  for (const [command, action] of Object.entries(commands)) bot.command(command, async (ctx, next) => {
    if (ctx.match.trim()) return next();
    if (!ctx.from) return;
    prune();
    const s: Session = { id: randomBytes(6).toString("hex"), owner: ctx.from.id, chat: ctx.chat.id, message: 0,
      expires: Date.now() + TTL, tokens: [], busy: false };
    sessions.set(s.id, s);
    try { await route(ctx, s, action); }
    catch { clearPending(s); sessions.delete(s.id); await ctx.reply("Menu tidak tersedia. Periksa izin admin atau konfigurasi bot."); }
  });
}
