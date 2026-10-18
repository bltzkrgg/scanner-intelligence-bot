import { InlineKeyboard } from "grammy";
import type { Chain } from "@sti/shared";

function explorerUrl(chain: Chain, mint: string): string {
  return chain === "sol" ? `https://solscan.io/token/${mint}`
    : chain === "bsc" ? `https://bscscan.com/token/${mint}`
    : `https://robinhoodchain.blockscout.com/token/${mint}`;
}

export function reportKeyboard(chain: Chain, mint: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Refresh", `report:f:${chain}:${mint}`)
    .text("Detail Risiko", `report:d:${chain}:${mint}`).row()
    .text("Status Runner", `report:r:${chain}:${mint}`)
    .url("Buka GMGN", `https://gmgn.ai/${chain}/token/${mint}`).row()
    .url("Explorer", explorerUrl(chain, mint))
    .copyText("Salin CA", mint);
}

export function runnerNotificationKeyboard(chain: Chain, mint: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("GMGN", `https://gmgn.ai/${chain}/token/${mint}`)
    .text("Detail Runner", `report:r:${chain}:${mint}`).row()
    .copyText("Salin CA", mint);
}
