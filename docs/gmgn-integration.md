# GMGN Integration Notes

Checked on 2026-10-06.

## Officially documented access

- GMGN's Q&A says there is no generally open Data API at present. Data API access is handled through an approval or IP-whitelist process for trading users.
- GMGN's Agent API documentation describes API-key based query capabilities through GMGN Skills and CLI.
- The official `GMGNAI/gmgn-skills` repository documents read-only CLI commands such as `gmgn-cli token info --chain sol --address <addr> --raw`, `gmgn-cli market trending`, `gmgn-cli market hot-searches`, and portfolio/track commands.

## MVP decision

This repo does not scrape undocumented GMGN web endpoints.

The live adapter uses `gmgn-cli token info --chain sol --address <mint> --raw` only when `GMGN_PROVIDER=cli` and `gmgn-cli` is installed/configured. Because the documented CLI response fields are broader than the MVP normalized schema, unsupported fields default to zero and are explicitly visible in the resulting snapshot.

The default adapter is fixture-backed (`GMGN_PROVIDER=mock`) so the scanner, scoring, report generation, API, and Telegram handler can be built and tested without inventing private endpoints.

## Required GMGN fields for production parity

- Token metadata: mint, symbol, name, creation time.
- Market quality: market cap, liquidity, volume, buy/sell counts, price change windows, liquidity lock/burn status.
- Distribution: top holder concentration, top holder list, holder count.
- Risk actors: bundler exposure, insider exposure, sniper exposure.
- Developer: deployer wallet, created token history, historical outcomes/rug rate, developer holdings.
- Smart money: smart money holder count, net flows, wallet-level activity and performance where available.
- K-line/OHLCV: at least 1m/5m/1h candles for outcome labeling and momentum research.

## Rate limits and auth

- GMGN Agent API requires an API key for query skills.
- Trading API docs mention `x-route-key` and one call every 5 seconds, but this MVP intentionally does not call trading endpoints.
- No private key is used or accepted by this project.
