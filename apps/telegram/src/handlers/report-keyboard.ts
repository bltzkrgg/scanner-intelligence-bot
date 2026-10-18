import { InlineKeyboard } from "grammy";
import type { Chain } from "@sti/shared";

export function reportKeyboard(chain: Chain, mint: string): InlineKeyboard {
  const explorer = chain === "sol" ? `https://solscan.io/token/${mint}`
    : chain === "bsc" ? `https://bscscan.com/token/${mint}`
    : `https://robinhoodchain.blockscout.com/token/${mint}`;
  return new InlineKeyboard()
    .text("Refresh", `report:f:${chain}:${mint}`)
    .text("Detail Risiko", `report:d:${chain}:${mint}`).row()
    .text("Status Runner", `report:r:${chain}:${mint}`)
    .url("Buka GMGN", `https://gmgn.ai/${chain}/token/${mint}`).row()
    .url("Explorer", explorer)
    .copyText("Salin CA", mint);
}
