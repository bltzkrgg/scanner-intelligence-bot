import { z } from "zod";
import type { Chain, MarketSnapshot } from "@sti/shared";

const poll = z.number().int().min(15).max(300);
const money = z.number().finite().nonnegative();
const maxAlerts = z.number().int().min(1).max(50);
const oldTokenVolumeFields = {
  enabled: z.boolean().default(true), minVolume5mUsd: money.default(150000),
  minLiquidityUsd: money.default(10000), spikeMultiplier: z.number().finite().gt(1).max(1000).default(3),
  cooldownMin: z.number().int().min(1).max(43200).default(60)
};
const oldTokenVolume = z.object(oldTokenVolumeFields);
const solFields = {
  oldTokenVolume: oldTokenVolume.extend({ minTotalFeesSol: money.default(0) }).prefault({}),
  enabled: z.boolean().default(true), pollIntervalSec: poll.default(60),
  minVolume5mUsd: money.default(100000), minMarketCapUsd: money.default(100000),
  minTotalFeesSol: money.default(10), maxAgeMin: z.number().int().min(1).max(43200).default(30),
  volumeSpikeMinTotalFeesSol: money.optional(),
  maxPerScan: maxAlerts.default(5), volumeSpikeMultiplier: z.number().finite().gt(1).max(1000).default(3),
  volumeSpikeMinSwaps5m: z.number().int().nonnegative().default(50),
  volumeSpikeMinLiquidityUsd: money.default(10000),
  volumeSpikeCooldownMin: z.number().int().min(1).max(43200).default(360)
};
const rhFields = {
  oldTokenVolume: oldTokenVolume.extend({ minTotalFeesEth: money.default(0) }).prefault({}),
  enabled: z.boolean().default(true), pollIntervalSec: poll.default(60),
  minVolume5mUsd: money.default(100000), minTotalFeesEth: money.default(0.1),
  maxPerScan: maxAlerts.default(5)
};
const bscFields = z.object(solFields).omit({ minTotalFeesSol: true, volumeSpikeMinTotalFeesSol: true }).extend({
  oldTokenVolume: oldTokenVolume.extend({ minTotalFeesBnb: money.default(0) }).prefault({}), volumeSpikeMinTotalFeesBnb: money.optional(),
  minVolume5mUsd: money.default(50000), minTotalFeesBnb: money.default(0.5),
  maxAgeMin: z.number().int().min(1).max(43200).default(60),
  volumeSpikeMinLiquidityUsd: money.default(20000)
}).shape;
export const alertConfigSchema = z.object({
  tokenAlerts: z.object(solFields).prefault({}),
  bscAlerts: z.object(bscFields).prefault({}),
  robinhoodAlerts: z.object(rhFields).prefault({})
}).transform((config) => ({ ...config,
  tokenAlerts: { ...config.tokenAlerts, volumeSpikeMinTotalFeesSol: config.tokenAlerts.volumeSpikeMinTotalFeesSol ?? config.tokenAlerts.minTotalFeesSol },
  bscAlerts: { ...config.bscAlerts, volumeSpikeMinTotalFeesBnb: config.bscAlerts.volumeSpikeMinTotalFeesBnb ?? config.bscAlerts.minTotalFeesBnb }
}));
export type AlertConfig = z.infer<typeof alertConfigSchema>;
export const defaultAlertConfig = (): AlertConfig => alertConfigSchema.parse({});

const fields: Record<string, z.ZodType> = Object.fromEntries([
  ...Object.entries(solFields).filter(([key]) => key !== "oldTokenVolume").map(([key, schema]) => [`tokenAlerts.${key}`, schema]),
  ...Object.entries(bscFields).filter(([key]) => key !== "oldTokenVolume").map(([key, schema]) => [`bscAlerts.${key}`, schema]),
  ...Object.entries(rhFields).filter(([key]) => key !== "oldTokenVolume").map(([key, schema]) => [`robinhoodAlerts.${key}`, schema]),
  ...[["tokenAlerts", "minTotalFeesSol"], ["bscAlerts", "minTotalFeesBnb"], ["robinhoodAlerts", "minTotalFeesEth"]].flatMap(([section, fee]) =>
    Object.entries({ ...oldTokenVolumeFields, [fee]: money })
      .map(([key, schema]) => [`${section}.oldTokenVolume.${key}`, schema]))
]);
const aliases: Record<string, string> = Object.fromEntries(Object.keys(fields).map((path) => {
  const [section, ...keys] = path.split(".");
  return [`${section}${keys.map((key) => key[0].toUpperCase() + key.slice(1)).join("")}`, path];
}));

export function updateAlertConfig(config: AlertConfig, key: string, input: string): { config: AlertConfig; key: string; value: unknown } {
  const path = Object.hasOwn(aliases, key) ? aliases[key] : key;
  if (!Object.hasOwn(fields, path)) throw new Error("Key tidak dikenal. Gunakan /getconfig.");
  const raw = path.endsWith(".enabled") ? input === "true" ? true : input === "false" ? false : input
    : input.trim() ? Number(input) : NaN;
  const result = fields[path].safeParse(raw);
  if (!result.success) throw new Error(`${path}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  const [section, property, nested] = path.split(".") as [keyof AlertConfig, string, string?];
  const next = structuredClone(config);
  if (property === "oldTokenVolume" && nested) Object.assign(next[section].oldTokenVolume, { [nested]: result.data });
  else Object.assign(next[section], { [property]: result.data });
  return { config: alertConfigSchema.parse(next), key: path, value: result.data };
}

function chainAlertConfig(config: AlertConfig, chain: Chain) {
  return chain === "sol" ? config.tokenAlerts : chain === "bsc" ? config.bscAlerts : config.robinhoodAlerts;
}

export function oldTokenVolumeConfig(config: AlertConfig, chain: Chain) {
  return chainAlertConfig(config, chain).oldTokenVolume;
}

export function evaluateOldTokenVolume(s: MarketSnapshot, config: AlertConfig): boolean {
  const chain = s.chain ?? "sol";
  const c = oldTokenVolumeConfig(config, chain);
  return alertsEnabled(config, chain) && c.enabled && s.source === "gmgn-cli" && !s.runnerBlockReason
    && s.priceUsd != null && Number.isFinite(s.priceUsd) && s.priceUsd > 0
    && s.volume5mUsd != null && Number.isFinite(s.volume5mUsd) && s.volume5mUsd >= c.minVolume5mUsd
    && s.liquidityUsd != null && Number.isFinite(s.liquidityUsd) && s.liquidityUsd >= c.minLiquidityUsd
    && meetsNativeFees(s, chain === "sol" ? config.tokenAlerts.oldTokenVolume.minTotalFeesSol
      : chain === "bsc" ? config.bscAlerts.oldTokenVolume.minTotalFeesBnb : config.robinhoodAlerts.oldTokenVolume.minTotalFeesEth);
}

function meetsNativeFees(s: MarketSnapshot, minimum: number): boolean {
  if (minimum === 0) return true;
  const native = s.chain === "bsc" ? "BNB" : s.chain === "robinhood" ? "ETH" : "SOL";
  return s.totalFeesNative != null && Number.isFinite(s.totalFeesNative) && s.totalFeesNative >= minimum
    && s.feesNativeSymbol === native;
}

export function volumeSpikeConfig(config: AlertConfig, chain: Chain) {
  return chain === "sol" ? config.tokenAlerts : chain === "bsc" ? config.bscAlerts : null;
}

function minimumNativeFees(config: AlertConfig, chain: Chain): number {
  return chain === "sol" ? config.tokenAlerts.minTotalFeesSol
    : chain === "bsc" ? config.bscAlerts.minTotalFeesBnb : config.robinhoodAlerts.minTotalFeesEth;
}

export function alertMinimumFees(config: AlertConfig, chain: Chain, kind: "candidate" | "spike" | "volume"): number {
  if (kind === "candidate") return minimumNativeFees(config, chain);
  if (kind === "spike") return chain === "sol" ? config.tokenAlerts.volumeSpikeMinTotalFeesSol
    : chain === "bsc" ? config.bscAlerts.volumeSpikeMinTotalFeesBnb : 0;
  return chain === "sol" ? config.tokenAlerts.oldTokenVolume.minTotalFeesSol
    : chain === "bsc" ? config.bscAlerts.oldTokenVolume.minTotalFeesBnb : config.robinhoodAlerts.oldTokenVolume.minTotalFeesEth;
}

export function alertsEnabled(config: AlertConfig, chain: Chain): boolean {
  return chainAlertConfig(config, chain).enabled;
}

export function alertInterval(config: AlertConfig, chain: Chain): number {
  return chainAlertConfig(config, chain).pollIntervalSec;
}

export function maxAlertsPerScan(config: AlertConfig, chain: Chain): number {
  return chainAlertConfig(config, chain).maxPerScan;
}

export type FilterResult = { passed: boolean; reasons: string[] };
export function evaluateTokenAlert(s: MarketSnapshot, config: AlertConfig): FilterResult {
  const reasons: string[] = [];
  const chain = s.chain ?? "sol";
  if (!alertsEnabled(config, chain)) reasons.push("Alert jaringan ini dinonaktifkan.");
  if (s.source !== "gmgn-cli" || !s.priceUsd || s.priceUsd <= 0) reasons.push("Harga live belum tersedia.");
  if (s.runnerBlockReason) reasons.push(s.runnerBlockReason);
  const c = chainAlertConfig(config, chain);
  if (s.volume5mUsd == null || s.volume5mUsd < c.minVolume5mUsd) reasons.push("Volume rolling 5 menit belum memenuhi minimum / belum tersedia.");
  const minFees = minimumNativeFees(config, chain);
  if (!meetsNativeFees(s, minFees)) reasons.push("Total fees native GMGN belum memenuhi minimum / belum tersedia.");
  const ageConfig = volumeSpikeConfig(config, chain);
  if (ageConfig) {
    if (s.marketCapUsd === null || s.marketCapUsd <= ageConfig.minMarketCapUsd) reasons.push("Market cap harus lebih besar dari minimum.");
    if (s.dexAgeMinutes == null || s.dexAgeMinutes > ageConfig.maxAgeMin) reasons.push("Umur sejak DEX open/migration melewati batas / belum tersedia.");
  }
  return { passed: reasons.length === 0, reasons };
}

export function evaluateVolumeSpike(s: MarketSnapshot, config: AlertConfig, baseline: number | null): FilterResult {
  const chain = s.chain ?? "sol";
  const c = volumeSpikeConfig(config, chain);
  const reasons: string[] = [];
  if (!c) return { passed: false, reasons: ["Volume spike config hanya tersedia untuk Solana/BSC."] };
  if (!c.enabled || s.source !== "gmgn-cli" || !s.priceUsd || s.priceUsd <= 0) reasons.push("Alert/harga live belum aktif.");
  if (s.runnerBlockReason) reasons.push(s.runnerBlockReason);
  if (baseline === null || baseline <= 0 || s.volume5mUsd == null || s.volume5mUsd / baseline < c.volumeSpikeMultiplier) reasons.push("Baseline belum siap atau lonjakan belum cukup.");
  if (s.volume5mUsd == null || s.volume5mUsd < c.minVolume5mUsd) reasons.push("Volume 5 menit belum cukup.");
  if (s.marketCapUsd === null || s.marketCapUsd <= c.minMarketCapUsd) reasons.push("Market cap belum cukup.");
  const spikeFees = chain === "sol" ? config.tokenAlerts.volumeSpikeMinTotalFeesSol : config.bscAlerts.volumeSpikeMinTotalFeesBnb;
  if (!meetsNativeFees(s, spikeFees)) reasons.push("Total fees native belum cukup.");
  if (s.swaps5m == null || s.swaps5m < c.volumeSpikeMinSwaps5m) reasons.push("Swaps 5 menit belum cukup.");
  if (s.liquidityUsd === null || s.liquidityUsd < c.volumeSpikeMinLiquidityUsd) reasons.push("Likuiditas belum cukup.");
  return { passed: reasons.length === 0, reasons };
}
