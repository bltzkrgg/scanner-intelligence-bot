import type { Context } from "grammy";
import { IntelligenceScanner } from "@sti/analysis";
import { formatTelegramReport } from "@sti/report";

export function createScanHandler(scanner: IntelligenceScanner) {
  return async function handleScan(ctx: Context): Promise<void> {
    const text = ctx.message?.text ?? "";
    const [, mint] = text.trim().split(/\s+/);

    if (!mint) {
      await ctx.reply("Kirim format: /scan <contract_address>");
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
