import type { Bot, Context } from "grammy";
import { IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import { ProviderError } from "@sti/gmgn";
import { formatTelegramReport, formatTelegramRisk, formatTelegramRunner, type TelegramReportContext } from "@sti/report";
import { parseTokenInput, type IntelligenceResult } from "@sti/shared";
import { resolveTokenInput } from "./token-input.js";
import { reportKeyboard } from "./report-keyboard.js";

export function registerScanHandlers(bot: Bot, scanner: IntelligenceScanner, runner?: RunnerMonitor): void {
  bot.command("scan", createScanHandler(scanner, "command", runner));
  bot.callbackQuery(/^scan:(sol|bsc|robinhood):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await scanInput(ctx, `${ctx.match[1]} ${ctx.match[2]}`, scanner, runner);
  });
  const refreshing = new Set<string>();
  bot.callbackQuery(/^report:([fdrn]):(sol|bsc|robinhood):(.+)$/, async (ctx) => {
    const input = parseTokenInput(`${ctx.match[2]} ${ctx.match[3]}`);
    if (!input?.chain || !scanner.chains.includes(input.chain)) {
      await ctx.answerCallbackQuery({ text: "CA tidak valid atau jaringan belum diaktifkan.", show_alert: true });
      return;
    }
    const action = ctx.match[1];
    const refresh = action === "f" || action === "n";
    const key = ctx.callbackQuery.inline_message_id ?? `${ctx.chat?.id}:${ctx.callbackQuery.message?.message_id}`;
    if (refreshing.has(key)) {
      await ctx.answerCallbackQuery({ text: "Permintaan untuk laporan ini masih diproses." });
      return;
    }
    refreshing.add(key);
    try {
      await ctx.answerCallbackQuery({ text: refresh ? "Mengambil data terbaru..." : "Mengambil detail..." });
      const result = await scanner.scan(input.mint, input.chain, refresh ? { forceRefresh: true } : undefined);
      const context = await observeResult(result, runner);
      if (action === "f") {
        await ctx.editMessageText(formatTelegramReport(result, context), {
          parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true },
          reply_markup: result.snapshot.source === "fixture" ? undefined : reportKeyboard(input.chain, input.mint)
        });
      } else {
        await ctx.reply(action === "n" ? formatTelegramReport(result, context) : action === "d" ? formatTelegramRisk(result) : formatTelegramRunner(result, context), {
          parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true },
          reply_markup: action === "n" && result.snapshot.source !== "fixture" ? reportKeyboard(input.chain, input.mint) : undefined
        });
      }
    } catch (error) {
      if (error instanceof Error && /message is not modified/i.test(error.message)) return;
      await ctx.reply(error instanceof ProviderError ? error.message
        : "Laporan gagal diperbarui. Pesan sebelumnya tetap tersimpan; coba lagi atau kirim CA ulang.");
    } finally { refreshing.delete(key); }
  });
  bot.on("message:text", createScanHandler(scanner, "address", runner));
}

export function createScanHandler(scanner: IntelligenceScanner, mode: "command" | "address" = "command", runner?: RunnerMonitor) {
  return async function handleScan(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? "";
    const input = mode === "address" ? text.trim() : text.trim().split(/\s+/).slice(1).join(" ");

    if (mode === "address" && !parseTokenInput(input)) {
      return;
    }

    await scanInput(ctx, input, scanner, runner);
  };
}

export async function scanInput(ctx: Context, text: string, scanner: IntelligenceScanner, runner?: RunnerMonitor): Promise<void> {
  const input = await resolveTokenInput(ctx, text, "scan", scanner.chains);
  if (!input) return;
  try {
    const result = await scanner.scan(input.mint, input.chain);
    const context = await observeResult(result, runner);
    await ctx.reply(formatTelegramReport(result, context), {
      parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true },
      reply_markup: result.snapshot.source === "fixture" ? undefined : reportKeyboard(input.chain, input.mint)
    });
  } catch (error) {
    await ctx.reply(error instanceof ProviderError ? error.message : "CA tidak valid atau data belum bisa diproses. Coba cek alamat mint lalu scan ulang.");
  }
}

async function observeResult(result: IntelligenceResult, runner?: RunnerMonitor): Promise<TelegramReportContext> {
  let runnerSaveFailed = false;
  if (runner) {
    try { await runner.observe(result.snapshot); }
    catch { runnerSaveFailed = true; }
  }
  const state = runner?.snapshot();
  return { alertConfig: state?.alertConfig, runnerActive: runner?.active ?? false, runnerSaveFailed,
    record: state?.records.find((entry) => entry.chain === result.snapshot.chain && entry.mint === result.snapshot.mint) };
}
