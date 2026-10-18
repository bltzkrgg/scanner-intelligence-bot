import type { Context } from "grammy";

export async function startCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Token Intelligence Bot | Solana, BSC, Robinhood Chain",
      "",
      "Kirim CA langsung untuk laporan. Untuk alamat 0x, pilih BSC atau RH melalui tombol. /scan bsc <CA> dan /scan rh <CA> juga tersedia.",
      "Bot ini bukan trading bot dan tidak memberi sinyal buy/sell."
    ].join("\n")
  );
}
