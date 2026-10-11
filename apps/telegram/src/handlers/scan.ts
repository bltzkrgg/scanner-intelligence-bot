import type { Bot, Context } from "grammy";
import { IntelligenceScanner } from "@sti/analysis";
import { formatTelegramReport } from "@sti/report";
import { solanaMintSchema } from "@sti/shared";

export function registerScanHandlers(bot: Bot, scanner: IntelligenceScanner): void {
  bot.command("scan", createScanHandler(scanner));
  bot.on("message:text", createScanHandler(scanner, "address"));
}

export function createScanHandler(scanner: IntelligenceScanner, mode: "command" | "address" = "command") {
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
      await ctx.reply(formatTelegramReport(result), { parse_mode: "MarkdownV2" });
    } catch (error) {
      await ctx.reply("CA tidak valid atau data belum bisa diproses. Coba cek alamat mint lalu scan ulang.");
    }
  };
}
