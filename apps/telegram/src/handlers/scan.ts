import type { Bot, Context } from "grammy";
import { IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import { ProviderError } from "@sti/gmgn";
import { formatTelegramReport } from "@sti/report";
import { solanaMintSchema } from "@sti/shared";

export function registerScanHandlers(bot: Bot, scanner: IntelligenceScanner, runner?: RunnerMonitor): void {
  bot.command("scan", createScanHandler(scanner, "command", runner));
  bot.on("message:text", createScanHandler(scanner, "address", runner));
}

export function createScanHandler(scanner: IntelligenceScanner, mode: "command" | "address" = "command", runner?: RunnerMonitor) {
  return async function handleScan(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? "";
    const mint = mode === "address" ? text.trim() : text.trim().split(/\s+/)[1];

    if (mode === "address" && !solanaMintSchema.safeParse(mint).success) {
      return;
    }

    if (!mint) {
      await ctx.reply("Kirim alamat mint Solana langsung, atau /scan <contract_address>.");
      return;
    }

    try {
      const result = await scanner.scan(mint);
      if (runner) await runner.observe(result.snapshot);
      await ctx.reply(formatTelegramReport(result), { parse_mode: "MarkdownV2" });
    } catch (error) {
      await ctx.reply(error instanceof ProviderError ? error.message : "CA tidak valid atau data belum bisa diproses. Coba cek alamat mint lalu scan ulang.");
    }
  };
}
