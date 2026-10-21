import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceScanner, RunnerMonitor, defaultAlertConfig, updateAlertConfig } from "@sti/analysis";
import { loadConfig } from "@sti/shared";
import { registerTelegramMenus } from "../../apps/telegram/src/handlers/menus.js";
import { registerConfigCommands } from "../../apps/telegram/src/handlers/config.js";
import { registerScanHandlers } from "../../apps/telegram/src/handlers/scan.js";
import { registerRunnerCommands } from "../../apps/telegram/src/handlers/runner.js";
import { registerUtilityCommands } from "../../apps/telegram/src/lifecycle.js";
import { CONFIG_FIELDS, configValue } from "../../apps/telegram/src/handlers/config-fields.js";
import { live, mint, otherMint, evm } from "./live-fixtures.js";

type Button = { text: string; callback_data?: string; copy_text?: { text: string } };
type View = { text: string; chat_id: number; message_id: number; reply_markup?: { inline_keyboard: Button[][] } };
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const bot = new Bot("test-token", { botInfo: { id: 1, is_bot: true, first_name: "Bot", username: "scanner_bot" } as never });
  const file = join(await mkdtemp(join(tmpdir(), "telegram-menu-")), "state.json");
  const adapter = { getTokenSnapshot: vi.fn(async (address: string, chain: "sol" | "bsc" | "robinhood" = "sol") => ({ ...live(), mint: address, chain,
    feesNativeSymbol: chain === "sol" ? "SOL" as const : chain === "bsc" ? "BNB" as const : "ETH" as const })) };
  const scanner = new IntelligenceScanner(adapter);
  const runner = new RunnerMonitor(adapter, file, true, ["sol", "bsc", "robinhood"]);
  await runner.init();
  const config = loadConfig({ TELEGRAM_ADMIN_IDS: "99", ENABLED_CHAINS: "sol,bsc,robinhood", TELEGRAM_RUNNER_CHAT_ID: "-200" });
  const calls: Array<{ method: string; payload: View }> = [];
  let sequence = 0;
  bot.api.config.use(async (_previous, method, payload) => {
    const view = { ...payload, message_id: "message_id" in payload ? payload.message_id : ++sequence } as View;
    calls.push({ method, payload: view });
    if (method === "sendMessage" || method === "editMessageText") {
      expect(view.text.length).toBeLessThanOrEqual(4096);
      for (const button of view.reply_markup?.inline_keyboard.flat() ?? []) {
        if (button.callback_data) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
      }
    }
    return { ok: true, result: method === "sendMessage" ? { message_id: view.message_id, date: 0,
      chat: { id: view.chat_id, type: "supergroup" }, text: view.text } : true } as never;
  });
  registerTelegramMenus(bot, runner, scanner, config);
  registerUtilityCommands(bot, config, runner);
  registerRunnerCommands(bot, runner, scanner, config);
  registerConfigCommands(bot, runner, config);
  registerScanHandlers(bot, scanner, runner);
  const user = (id: number) => ({ id, is_bot: false, first_name: "User" });
  async function send(text: string, owner = 99, chat = -10099) {
    await bot.handleUpdate({ update_id: ++sequence, message: { message_id: ++sequence, date: 0,
      chat: { id: chat, type: "supergroup", title: "Test" }, from: user(owner), text,
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] } : {}) } });
  }
  const view = () => calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && c.payload.reply_markup).at(-1)!.payload;
  const buttons = (v = view()) => v.reply_markup!.inline_keyboard.flat();
  const button = (label: string, v = view()) => {
    const found = buttons(v).find((b) => b.text.startsWith(label));
    if (!found?.callback_data) throw new Error(`Button not found: ${label}; ${JSON.stringify(buttons(v))}`);
    return found.callback_data;
  };
  async function pressData(data: string, owner = 99, v = view(), chat = v.chat_id) {
    await bot.handleUpdate({ update_id: ++sequence, callback_query: { id: String(sequence), chat_instance: "test", data, from: user(owner),
      message: { message_id: v.message_id, date: 0, chat: { id: chat, type: "supergroup", title: "Test" }, text: v.text } } });
  }
  const press = async (label: string, owner = 99) => pressData(button(label), owner);
  return { bot, config, adapter, scanner, runner, file, calls, send, view, buttons, button, press, pressData };
}

describe("Telegram button menus", () => {
  it("keeps every menu field and preset consistent with validated config keys", () => {
    const original = defaultAlertConfig();
    for (const field of CONFIG_FIELDS) {
      expect(["number", "boolean"]).toContain(typeof configValue(original, field));
      for (const preset of field.presets) {
        const updated = updateAlertConfig(original, field.path, preset);
        expect(configValue(updated.config, field)).toBe(updated.value);
      }
    }
  });
  it("shows owner-scoped menus with admin options hidden from regular users", async () => {
    const t = await setup();
    await t.send("/start", 2);
    expect(t.buttons().map((b) => b.text)).toEqual(["Scan Token", "Daftar Runner", "Status Bot", "Bantuan"]);
    const publicView = t.view();
    await t.pressData(t.button("Scan Token"), 99, publicView);
    expect(t.calls.at(-1)!.method).toBe("answerCallbackQuery");
    expect(t.calls.at(-1)!.payload.text).toContain("bukan milikmu");
    await t.send("/start");
    expect(t.buttons().map((b) => b.text)).toContain("Panel Admin");
    const data = t.button("Pengaturan");
    await t.pressData(data, 2);
    expect(t.runner.snapshot().alertConfig.tokenAlerts.enabled).toBe(true);
    for (const call of t.calls) for (const button of call.payload.reply_markup?.inline_keyboard.flat() ?? []) {
      if (button.callback_data) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it("checks admin authorization even for forged callbacks on a user's own menu", async () => {
    const t = await setup();
    await t.send("/start", 2);
    const data = t.button("Scan Token").replace(/scan$/, "cfg");
    await t.pressData(data, 2);
    expect(t.calls.at(-1)!.payload.text).toContain("Periksa izin admin");
  });

  it.each(["Solana", "BSC", "Robinhood"])("supports configurable native volume fees in the %s submenu", async (label) => {
    const t = await setup();
    await t.send("/setconfig");
    await t.press(label);
    const chainView = t.view();
    if (label === "Robinhood") expect(t.buttons().some((b) => b.text.includes("Legacy"))).toBe(false);
    await t.press("Volume");
    await t.press("Minimum total fees");
    const unit = label === "Solana" ? "SOL" : label === "BSC" ? "BNB" : "ETH";
    expect(t.buttons().map((b) => b.text).join(" ")).toContain(unit);
    await t.press("Nilai Lain");
    await t.send("abc");
    expect(t.calls.at(-1)!.payload.text).toContain("oldTokenVolume.minTotalFees");
    await t.send("2.5");
    expect(t.view().text).toContain(`Saat ini: 2.5 ${unit}`);
    expect(t.view().message_id).toBe(chainView.message_id);
    await t.press("Nonaktif");
    expect(t.view().text).toContain("Saat ini: Nonaktif");
    const restored = new RunnerMonitor(t.adapter, t.file, true);
    await restored.init();
    const section = label === "Solana" ? "tokenAlerts" : label === "BSC" ? "bscAlerts" : "robinhoodAlerts";
    expect(Object.entries(restored.snapshot().alertConfig[section].oldTokenVolume).find(([key]) => key.startsWith("minTotalFees"))![1]).toBe(0);
  });

  it("scopes numeric input to its user/chat, permits retry, and cancels on navigation", async () => {
    const t = await setup();
    await t.send("/setconfig"); await t.press("Solana"); await t.press("Kandidat Baru");
    await t.press("Minimum volume"); await t.press("Nilai Lain");
    await t.send("250000", 2); await t.send("250000", 99, -10088);
    expect(t.runner.snapshot().alertConfig.tokenAlerts.minVolume5mUsd).toBe(100000);
    await t.send("250000");
    expect(t.runner.snapshot().alertConfig.tokenAlerts.minVolume5mUsd).toBe(250000);
    await t.press("Nilai Lain"); await t.press("Batal"); await t.send("900000");
    expect(t.runner.snapshot().alertConfig.tokenAlerts.minVolume5mUsd).toBe(250000);
  });

  it("expires input and callbacks without interpreting expired input as a new scan", async () => {
    const t = await setup();
    await t.send("/scan"); await t.press("Solana");
    const oldView = t.view(); const data = t.button("Batal");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60000);
    await t.send(mint);
    expect(t.adapter.getTokenSnapshot).not.toHaveBeenCalled();
    expect(t.calls.at(-1)!.payload.text).toContain("kedaluwarsa");
    await t.pressData(data, 99, oldView);
    expect(t.calls.at(-1)!.payload.text).toContain("kedaluwarsa");
    clock.mockRestore();
  });

  it("preserves bare-CA scans and text config commands, while selected EVM networks remain explicit", async () => {
    const t = await setup();
    await t.send("/setconfig tokenAlerts.pollIntervalSec 15");
    expect(t.runner.snapshot().alertConfig.tokenAlerts.pollIntervalSec).toBe(15);
    await t.send(mint);
    expect(t.adapter.getTokenSnapshot).toHaveBeenCalledWith(mint, "sol", undefined);
    await t.send("/scan"); await t.press("BSC"); await t.send(evm);
    expect(t.adapter.getTokenSnapshot).toHaveBeenCalledWith(evm, "bsc", undefined);
    await t.send(`/runner rh ${evm}`);
    expect(t.adapter.getTokenSnapshot).toHaveBeenCalledWith(evm, "robinhood", undefined);
  });

  it("requires one-use confirmation to pause, resume or delete history", async () => {
    const t = await setup(); await t.runner.observe(live());
    await t.send("/runner_off");
    expect(t.runner.active).toBe(true);
    const confirmationView = t.view(); const confirmation = t.button("Konfirmasi");
    await t.pressData(confirmation);
    expect(t.runner.active).toBe(false);
    await t.pressData(confirmation, 99, confirmationView);
    expect(t.runner.active).toBe(false);
    await t.send("/runner_on"); await t.press("Konfirmasi");
    expect(t.runner.active).toBe(true);
    await t.send("/runner_remove"); await t.press("Solana"); await t.send(mint);
    expect(t.runner.snapshot().records).toHaveLength(1);
    await t.press("Konfirmasi");
    expect(t.runner.snapshot().records).toHaveLength(0);
  });

  it("paginates runner lists and preserves token identity across navigation", async () => {
    const t = await setup();
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    for (const suffix of alphabet.slice(0, 5)) await t.runner.observe({ ...live(), mint: mint.slice(0, -1) + suffix });
    await t.send("/runners");
    expect(t.view().text).toContain("Halaman 1/2");
    const expectedMint = t.runner.snapshot().records.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0].mint;
    const tokenButton = t.buttons().find((b) => b.text.startsWith("LIVE"))!.callback_data!;
    await t.press("Berikutnya");
    expect(t.view().text).toContain("Halaman 2/2");
    await t.pressData(tokenButton);
    expect(t.view().text).toContain(expectedMint);
    await t.press("Hapus Histori"); await t.press("Batal");
    expect(t.runner.snapshot().records).toHaveLength(5);
  });

  it("offers copyable IDs, status refresh and tests the dedicated alert destination", async () => {
    const t = await setup();
    await t.send("/chatid");
    expect(t.buttons().find((b) => b.text === "Salin User ID")!.copy_text).toEqual({ text: "99" });
    await t.send("/status"); await t.press("Perbarui");
    expect(t.view().text).toContain("Solana: AKTIF");
    await t.send("/runner_test");
    expect(t.calls.some((c) => c.method === "sendMessage" && String(c.payload.chat_id) === "-200")).toBe(true);
  });
});
