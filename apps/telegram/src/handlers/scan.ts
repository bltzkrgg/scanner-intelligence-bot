import type { Bot, Context } from "grammy";
import { IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import { ProviderError } from "@sti/gmgn";
import { formatTelegramReport } from "@sti/report";
import { parseTokenInput } from "@sti/shared";
import { resolveTokenInput } from "./token-input.js";

export function registerScanHandlers(bot: Bot, scanner: IntelligenceScanner, runner?: RunnerMonitor): void {
  bot.command("scan", createScanHandler(scanner, "command", runner));
  bot.callbackQuery(/^scan:(sol|bsc|robinhood):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await scanInput(ctx, `${ctx.match[1]} ${ctx.match[2]}`, scanner, runner);
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

async function scanInput(ctx: Context, text: string, scanner: IntelligenceScanner, runner?: RunnerMonitor): Promise<void> {
  const input = await resolveTokenInput(ctx, text, "scan", scanner.chains);
  if (!input) return;
  try {
    const result = await scanner.scan(input.mint, input.chain);
    if (runner) await runner.observe(result.snapshot);
    await ctx.reply(formatTelegramReport(result), { parse_mode: "MarkdownV2" });
  } catch (error) {
    await ctx.reply(error instanceof ProviderError ? error.message : "CA tidak valid atau data belum bisa diproses. Coba cek alamat mint lalu scan ulang.");
  }
}
