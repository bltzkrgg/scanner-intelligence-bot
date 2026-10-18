import { z } from "zod";
import type { Chain, MarketSnapshot } from "@sti/shared";

const poll = z.number().int().min(15).max(300);
const money = z.number().finite().nonnegative();
const maxAlerts = z.number().int().min(1).max(50);
const solFields = {
  enabled: z.boolean().default(true), pollIntervalSec: poll.default(60),
  minVolume5mUsd: money.default(100000), minMarketCapUsd: money.default(100000),
  minTotalFeesSol: money.default(10), maxAgeMin: z.number().int().min(1).max(43200).default(30),
  maxPerScan: maxAlerts.default(5), volumeSpikeMultiplier: z.number().finite().gt(1).max(1000).default(3),
  volumeSpikeMinSwaps5m: z.number().int().nonnegative().default(50),
  volumeSpikeMinLiquidityUsd: money.default(10000),
  volumeSpikeCooldownMin: z.number().int().min(1).max(43200).default(360)
};
const rhFields = {
  enabled: z.boolean().default(true), pollIntervalSec: poll.default(60),
  minVolume5mUsd: money.default(100000), minTotalFeesEth: money.default(0.1),
  maxPerScan: maxAlerts.default(5)
};
export const alertConfigSchema = z.object({
  tokenAlerts: z.object(solFields).prefault({}),
  robinhoodAlerts: z.object(rhFields).prefault({})
});
export type AlertConfig = z.infer<typeof alertConfigSchema>;
export const defaultAlertConfig = (): AlertConfig => alertConfigSchema.parse({});

const fields: Record<string, z.ZodType> = Object.fromEntries([
  ...Object.entries(solFields).map(([key, schema]) => [`tokenAlerts.${key}`, schema]),
  ...Object.entries(rhFields).map(([key, schema]) => [`robinhoodAlerts.${key}`, schema])
]);
const aliases: Record<string, string> = Object.fromEntries(Object.keys(fields).map((path) => {
  const [section, key] = path.split(".");
  return [`${section}${key[0].toUpperCase()}${key.slice(1)}`, path];
}));

export function updateAlertConfig(config: AlertConfig, key: string, input: string): { config: AlertConfig; key: string; value: unknown } {
  const path = Object.hasOwn(aliases, key) ? aliases[key] : key;
  if (!Object.hasOwn(fields, path)) throw new Error("Key tidak dikenal. Gunakan /getconfig.");
  const raw = path.endsWith(".enabled") ? input === "true" ? true : input === "false" ? false : input
    : input.trim() ? Number(input) : NaN;
  const result = fields[path].safeParse(raw);
  if (!result.success) throw new Error(`${path}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  const [section, property] = path.split(".") as [keyof AlertConfig, string];
  const next = structuredClone(config);
  Object.assign(next[section], { [property]: result.data });
  return { config: alertConfigSchema.parse(next), key: path, value: result.data };
}

export function alertsEnabled(config: AlertConfig, chain: Chain): boolean {
  return chain === "sol" ? config.tokenAlerts.enabled : chain === "robinhood" ? config.robinhoodAlerts.enabled : true;
}

export function alertInterval(config: AlertConfig, chain: Chain, fallback: number): number {
  return chain === "sol" ? config.tokenAlerts.pollIntervalSec : chain === "robinhood" ? config.robinhoodAlerts.pollIntervalSec : fallback;
}

export function maxAlertsPerScan(config: AlertConfig, chain: Chain): number {
  return chain === "sol" ? config.tokenAlerts.maxPerScan : chain === "robinhood" ? config.robinhoodAlerts.maxPerScan : 5;
}

export type FilterResult = { passed: boolean; reasons: string[] };
export function evaluateTokenAlert(s: MarketSnapshot, config: AlertConfig): FilterResult {
  const reasons: string[] = [];
  const chain = s.chain ?? "sol";
  if (chain === "bsc") reasons.push("BSC memakai rule Runner Score, bukan config Solana/RH.");
  if (!alertsEnabled(config, chain)) reasons.push("Alert jaringan ini dinonaktifkan.");
  if (s.source !== "gmgn-cli" || !s.priceUsd || s.priceUsd <= 0) reasons.push("Harga live belum tersedia.");
  if (s.runnerBlockReason) reasons.push(s.runnerBlockReason);
  const c = chain === "sol" ? config.tokenAlerts : config.robinhoodAlerts;
  if (s.volume5mUsd == null || s.volume5mUsd < c.minVolume5mUsd) reasons.push("Volume rolling 5 menit belum memenuhi minimum / belum tersedia.");
  const minFees = chain === "sol" ? config.tokenAlerts.minTotalFeesSol : config.robinhoodAlerts.minTotalFeesEth;
  if (s.totalFeesNative == null || s.totalFeesNative < minFees) reasons.push("Total fees native GMGN belum memenuhi minimum / belum tersedia.");
  if (chain === "sol") {
    if (s.marketCapUsd === null || s.marketCapUsd <= config.tokenAlerts.minMarketCapUsd) reasons.push("Market cap harus lebih besar dari minimum.");
    if (s.dexAgeMinutes == null || s.dexAgeMinutes > config.tokenAlerts.maxAgeMin) reasons.push("Umur sejak DEX open/migration melewati batas / belum tersedia.");
  }
  return { passed: reasons.length === 0, reasons };
}

export function evaluateVolumeSpike(s: MarketSnapshot, config: AlertConfig, baseline: number | null): FilterResult {
  const c = config.tokenAlerts;
  const reasons: string[] = [];
  if (s.chain && s.chain !== "sol") reasons.push("Volume spike config ini khusus Solana.");
  if (!c.enabled || s.source !== "gmgn-cli" || !s.priceUsd || s.priceUsd <= 0) reasons.push("Alert/harga live belum aktif.");
  if (s.runnerBlockReason) reasons.push(s.runnerBlockReason);
  if (baseline === null || baseline <= 0 || s.volume5mUsd == null || s.volume5mUsd / baseline < c.volumeSpikeMultiplier) reasons.push("Baseline belum siap atau lonjakan belum cukup.");
  if (s.volume5mUsd == null || s.volume5mUsd < c.minVolume5mUsd) reasons.push("Volume 5 menit belum cukup.");
  if (s.marketCapUsd === null || s.marketCapUsd <= c.minMarketCapUsd) reasons.push("Market cap belum cukup.");
  if (s.totalFeesNative == null || s.totalFeesNative < c.minTotalFeesSol) reasons.push("Total fees SOL belum cukup.");
  if (s.swaps5m == null || s.swaps5m < c.volumeSpikeMinSwaps5m) reasons.push("Swaps 5 menit belum cukup.");
  if (s.liquidityUsd === null || s.liquidityUsd < c.volumeSpikeMinLiquidityUsd) reasons.push("Likuiditas belum cukup.");
  return { passed: reasons.length === 0, reasons };
}
