import { InlineKeyboard, type Context } from "grammy";
import { CHAIN_NAMES, parseTokenInput, type Chain } from "@sti/shared";

export async function resolveTokenInput(ctx: Context, text: string, action: "scan" | "runner", chains: Chain[]): Promise<{ mint: string; chain: Chain } | null> {
  const input = parseTokenInput(text);
  if (!input) {
    await ctx.reply(`Kirim CA langsung atau /${action} [sol|bsc|rh] <CA>.`);
    return null;
  }
  if (input.chain) {
    if (!chains.includes(input.chain)) { await ctx.reply("Jaringan ini belum diaktifkan pada ENABLED_CHAINS."); return null; }
    return { mint: input.mint, chain: input.chain };
  }
  const evmChains = chains.filter((chain) => chain !== "sol");
  if (evmChains.length === 1) return { mint: input.mint, chain: evmChains[0] };
  if (!evmChains.length) { await ctx.reply("Jaringan EVM belum diaktifkan."); return null; }
  const keyboard = new InlineKeyboard();
  for (const chain of evmChains) keyboard.text(CHAIN_NAMES[chain], `${action}:${chain}:${input.mint}`);
  await ctx.reply("Alamat 0x dapat digunakan pada beberapa jaringan. Pilih jaringan token:", { reply_markup: keyboard });
  return null;
}
