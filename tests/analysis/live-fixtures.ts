import { parseTokenInfo } from "../../packages/gmgn/src/client.js";

export const mint = "So11111111111111111111111111111111111111112";
export const otherMint = "7UAWdJjrBykopzco6bCBmMLdggaiec6bd4bTKmQqpump";
export const info = {
  address: mint, symbol: "LIVE", name: "Live Token", circulating_supply: "1000000",
  liquidity: "75000", creation_timestamp: 1700000000, holder_count: 1000,
  price: { price: "1", price_1h: "0.8", price_6h: "0.5", volume_24h: "250000", buys_1h: 150, sells_1h: 70 },
  stat: { top_10_holder_rate: "0.2" }, dev: { creator_open_count: 4 },
  wallet_tags_stat: { smart_wallets: 8, sniper_wallets: 99 }
};
export const security = { top_10_holder_rate: 0.2, suspected_insider_hold_rate: 0.04, is_wash_trading: false };
export const live = () => parseTokenInfo(info, mint, security);
