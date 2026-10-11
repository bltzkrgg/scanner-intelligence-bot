import type { Context } from "grammy";

export async function startCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Solana Token Intelligence Bot",
      "",
      "Kirim alamat mint Solana langsung untuk mendapat laporan. /scan <contract_address> juga bisa digunakan.",
      "Bot ini bukan trading bot dan tidak memberi sinyal buy/sell."
    ].join("\n")
  );
}
