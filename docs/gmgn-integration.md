# GMGN Integration Notes

Updated and tested on 2026-10-18 with official gmgn-cli 1.6.7 and its documented public demo key. Use your own query key for bot operation.

## Officially documented access

- GMGN's Agent API documentation describes API-key based query capabilities through GMGN Skills and CLI. Access depends on the account's plan and endpoint availability.
- The official `GMGNAI/gmgn-skills` repository documents read-only CLI commands such as `gmgn-cli token info --chain sol --address <addr> --raw`, `gmgn-cli market trending`, `gmgn-cli market hot-searches`, and portfolio/track commands.

## MVP decision

This repo does not scrape undocumented GMGN web endpoints.

The live adapter uses read-only `token info` and `token security` with `--chain <sol|bsc|robinhood> --address <mint> --raw`. Discovery uses `market trending --chain <chain> --interval 5m --limit 10 --raw`. Supported payloads include direct objects and successful `{code:0,data:...}` envelopes, both observed in CLI 1.6.7. Response mint must match the requested mint; EVM comparisons are case-insensitive. Provider failures never fall back to fixture data.

Enabled networks are explicit. Bare EVM addresses require chain selection in Telegram or a chain argument in the API. Caches and runner histories use chain + normalized address. Solana mint/freeze rules are not applied to EVM. BSC requires known honeypot status; unavailable RH honeypot coverage is disclosed in reports and alerts rather than interpreted as safe. Known adverse findings block candidates on all chains. Real-world provider permissions and plan limits still apply; enabling a network does not imply a successful live health check.

Token fields are parsed with Zod. Price/windows, trades and volume come from nested `price`; concentration from `stat`/security; smart wallet counts from `wallet_tags_stat`; launched-token count from `dev`. Market cap is explicitly calculated as current price times circulating supply. Missing fields stay `null`. Insider/bundler trading-volume fractions are not converted into supply-holding percentages and sniper counts are not percentages. Supply locked is not treated as LP locked. See [multi-provider enrichment](providers.md) for optional supply exposure, developer bonding, authorities and FOMO data.

Historical scores/classification and similar-token statistics default to `null`: no synthetic benchmark is implicitly used. Runner Score is an experimental market rule, not a calibrated historical score. Its data, persistence and activation are documented in [live-and-runner.md](live-and-runner.md).

The default adapter remains fixture-backed (`GMGN_PROVIDER=mock`) for development. Telegram displays only a clear demo notice, not token metrics or a fake assessment. The API exposes the fixture source/warning and null historical scores.

## Required GMGN fields for production parity

- Token metadata: mint, symbol, name, creation time.
- Market quality: market cap, liquidity, volume, buy/sell counts, price change windows, liquidity lock/burn status.
- Distribution: top holder concentration, top holder list, holder count.
- Risk actors: bundler exposure, insider exposure, sniper exposure.
- Developer: deployer wallet, token count and bonding history from MadeOnSol; developer holdings remain separate.
- Smart money: smart money holder count, net flows, wallet-level activity and performance where available.
- K-line/OHLCV: at least 1m/5m/1h candles for outcome labeling and momentum research.

## Rate limits and auth

- GMGN Agent API requires an API key for query skills.
- CLI calls are serialized with a minimum 1.2-second gap, same-mint requests are deduplicated, and successful snapshots are cached for 30 seconds. Authentication/plan/rate-limit failures activate a local five-minute cooldown. CLI automatic rate-limit retry waits are disabled. These are local controls, not a promise of a particular GMGN plan quota.
- No private key is used or accepted by this project.

## References

- [Official token field reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md)
- [Official market field reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md)
- [CLI implementation](https://github.com/GMGNAI/gmgn-skills)
