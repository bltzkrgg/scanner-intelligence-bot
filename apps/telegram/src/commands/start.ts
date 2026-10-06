import type { Context } from "grammy";

export async function startCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Solana Token Intelligence Bot",
      "",
      "Kirim /scan <contract_address> untuk laporan historis berbasis data.",
      "Bot ini bukan trading bot dan tidak memberi sinyal buy/sell."
    ].join("\n")
  );
}
