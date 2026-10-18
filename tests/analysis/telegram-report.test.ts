import { Bot } from "grammy";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { IntelligenceScanner, RunnerMonitor } from "../../packages/analysis/src/index.js";
import { registerScanHandlers } from "../../apps/telegram/src/handlers/scan.js";
import { reportKeyboard } from "../../apps/telegram/src/handlers/report-keyboard.js";
import { live, mint, evm } from "./live-fixtures.js";
import type { Chain } from "../../packages/shared/src/chains.js";

async function setup(chains: Chain[] = ["sol", "bsc", "robinhood"], editError?: string) {
  const bot = new Bot("test-token", { botInfo: {
    id: 1, is_bot: true, first_name: "Scanner", username: "scanner_bot",
    can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
    allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false
  } });
  const request = vi.fn();
  bot.api.config.use(async (_previous, method, payload) => {
    request(method, payload);
    if (method === "editMessageText" && editError) return { ok: false, error_code: 400, description: editError } as never;
    return { ok: true, result: true } as never;
  });
  const adapter = { getTokenSnapshot: async (address: string, chain: Chain = "sol") => ({ ...live(), mint: address, chain }) };
  const scanner = new IntelligenceScanner(adapter, undefined, chains);
  const scan = vi.spyOn(scanner, "scan");
  const runner = new RunnerMonitor(adapter, join(await mkdtemp(join(tmpdir(), "report-bot-")), "state.json"), true, chains);
  await runner.init();
  registerScanHandlers(bot, scanner, runner);
  async function send(text: string) {
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 1,
      chat: { id: 2, type: "private", first_name: "User" }, from: { id: 2, is_bot: false, first_name: "User" }, text } });
  }
  async function press(data: string) {
    await bot.handleUpdate({ update_id: 2, callback_query: { id: "cb", chat_instance: "chat", data,
      from: { id: 2, is_bot: false, first_name: "User" }, message: { message_id: 9, date: 1,
        chat: { id: 2, type: "private", first_name: "User" }, text: "Old report" } } });
  }
  return { bot, request, scan, scanner, runner, send, press };
}

describe("compact Telegram report actions", () => {
  it("attaches all six buttons with chain-specific links and valid callback lengths", () => {
    for (const chain of ["sol", "bsc", "robinhood"] as const) {
      const address = chain === "sol" ? mint : evm;
      const buttons = reportKeyboard(chain, address).inline_keyboard.flat();
      expect(buttons.map((b) => b.text)).toEqual(["Refresh", "Detail Risiko", "Status Runner", "Buka GMGN", "Explorer", "Salin CA"]);
      expect(buttons[3]).toEqual({ text: "Buka GMGN", url: `https://gmgn.ai/${chain}/token/${address}` });
      expect(buttons[5]).toEqual({ text: "Salin CA", copy_text: { text: address } });
      const domain = chain === "sol" ? "solscan.io" : chain === "bsc" ? "bscscan.com" : "robinhoodchain.blockscout.com";
      expect(buttons[4]).toEqual({ text: "Explorer", url: `https://${domain}/token/${address}` });
      for (const button of buttons) if ("callback_data" in button) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it("sends compact MarkdownV2 reports with disabled previews and inline actions", async () => {
    const { send, request } = await setup();
    await send(mint);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      text: expect.stringContaining("*Market Cap*"), parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
      reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
    }));
  });

  it("refreshes the same message with a forced provider query and keeps its buttons", async () => {
    const { press, scan, request } = await setup();
    await press(`report:f:sol:${mint}`);
    expect(scan).toHaveBeenCalledExactlyOnceWith(mint, "sol", { forceRefresh: true });
    expect(request).toHaveBeenCalledWith("answerCallbackQuery", expect.anything());
    expect(request).toHaveBeenCalledWith("editMessageText", expect.objectContaining({
      chat_id: 2, message_id: 9, parse_mode: "MarkdownV2", reply_markup: expect.anything()
    }));
    expect(request.mock.calls.filter(([method]) => method === "sendMessage")).toHaveLength(0);
  });

  it("opens separate risk and runner details with the correct EVM network", async () => {
    const { press, scan, request } = await setup();
    await press(`report:d:bsc:${evm}`);
    expect(scan).toHaveBeenLastCalledWith(evm, "bsc", undefined);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("*Detail Risiko*") }));
    await press(`report:r:robinhood:${evm}`);
    expect(scan).toHaveBeenLastCalledWith(evm, "robinhood", undefined);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("*Status Runner*") }));
    expect(request).not.toHaveBeenCalledWith("editMessageText", expect.anything());
  });

  it("rejects invalid or disabled-chain buttons without querying GMGN", async () => {
    const { press, scan, request } = await setup(["sol"]);
    await press(`report:f:bsc:${evm}`);
    await press("report:d:sol:not-an-address");
    expect(scan).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("answerCallbackQuery", expect.objectContaining({ show_alert: true }));
  });

  it("keeps the previous message on provider failure and permits retry", async () => {
    const { press, scan, request } = await setup();
    scan.mockRejectedValueOnce(new Error("provider credentials must not appear"));
    await press(`report:f:sol:${mint}`);
    expect(request).not.toHaveBeenCalledWith("editMessageText", expect.anything());
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("Pesan sebelumnya tetap tersimpan") }));
    expect(JSON.stringify(request.mock.calls)).not.toContain("provider credentials");
    await press(`report:f:sol:${mint}`);
    expect(request).toHaveBeenCalledWith("editMessageText", expect.anything());
  });

  it("does not lose the market report if runner state cannot be written", async () => {
    const { send, runner, request } = await setup();
    vi.spyOn(runner, "observe").mockRejectedValue(new Error("read-only filesystem"));
    await send(mint);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({
      text: expect.stringContaining("Histori runner gagal disimpan")
    }));
  });

  it("handles unchanged messages without sending a false failure", async () => {
    const { press, request } = await setup(["sol"], "Bad Request: message is not modified");
    await press(`report:f:sol:${mint}`);
    expect(request).toHaveBeenCalledWith("editMessageText", expect.anything());
    expect(request).not.toHaveBeenCalledWith("sendMessage", expect.anything());
  });

  it("informs the user if an older message can no longer be edited", async () => {
    const { press, request } = await setup(["sol"], "Bad Request: message can't be edited");
    await press(`report:f:sol:${mint}`);
    expect(request).toHaveBeenCalledWith("sendMessage", expect.objectContaining({ text: expect.stringContaining("kirim CA ulang") }));
  });

  it("coalesces overlapping actions on the same report", async () => {
    const { press, scan, request } = await setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const original = scan.getMockImplementation()!;
    scan.mockImplementationOnce(async (...args) => { await pending; return original(...args); });
    const first = press(`report:f:sol:${mint}`);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    await press(`report:f:sol:${mint}`);
    expect(request).toHaveBeenCalledWith("answerCallbackQuery", expect.objectContaining({ text: expect.stringContaining("masih diproses") }));
    release();
    await first;
    expect(scan).toHaveBeenCalledOnce();
  });
});
