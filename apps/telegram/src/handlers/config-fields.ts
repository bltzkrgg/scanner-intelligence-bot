import type { AlertConfig } from "@sti/analysis";
import type { Chain } from "@sti/shared";

export type ConfigGroup = "general" | "new" | "old" | "spike" | "delivery";
export type ConfigField = { chain: Chain; group: ConfigGroup; path: string; label: string; presets: string[]; unit: string };
export const CONFIG_FIELDS: ConfigField[] = [];
for (const chain of ["sol", "bsc", "robinhood"] as const) {
  const prefix = chain === "sol" ? "tokenAlerts" : chain === "bsc" ? "bscAlerts" : "robinhoodAlerts";
  const native = chain === "sol" ? "SOL" : chain === "bsc" ? "BNB" : "ETH";
  const feeKey = chain === "sol" ? "minTotalFeesSol" : chain === "bsc" ? "minTotalFeesBnb" : "minTotalFeesEth";
  const fees = chain === "sol" ? ["0", "5", "10"] : chain === "bsc" ? ["0", "0.5", "1"] : ["0", "0.1", "0.5"];
  const add = (group: ConfigGroup, key: string, label: string, presets: string[], unit = "") =>
    CONFIG_FIELDS.push({ chain, group, path: `${prefix}.${key}`, label, presets, unit });
  add("general", "enabled", "Alert jaringan", ["true", "false"]);
  add("delivery", "pollIntervalSec", "Interval polling", ["15", "60", "120"], "detik");
  add("delivery", "maxPerScan", "Maksimum alert per scan", ["5", "10", "20"]);
  add("new", "minVolume5mUsd", "Minimum volume 5m", ["50000", "100000", "150000"], "USD");
  add("new", feeKey, "Minimum total fees", fees, native);
  if (chain !== "robinhood") {
    add("new", "minMarketCapUsd", "Minimum market cap", ["50000", "100000", "250000"], "USD");
    add("new", "maxAgeMin", "Maksimum umur DEX", ["30", "60", "120"], "menit");
    add("spike", `volumeSpikeMinTotalFees${chain === "sol" ? "Sol" : "Bnb"}`, "Minimum total fees", fees, native);
    add("spike", "volumeSpikeMultiplier", "Minimum lonjakan", ["2", "3", "5"], "x");
    add("spike", "volumeSpikeMinSwaps5m", "Minimum swaps 5m", ["25", "50", "100"]);
    add("spike", "volumeSpikeMinLiquidityUsd", "Minimum likuiditas", ["10000", "20000", "50000"], "USD");
    add("spike", "volumeSpikeCooldownMin", "Cooldown", ["60", "180", "360"], "menit");
  }
  add("old", "oldTokenVolume.enabled", "Alert volume token lama", ["true", "false"]);
  add("old", "oldTokenVolume.minVolume5mUsd", "Minimum volume 5m", ["100000", "150000", "250000"], "USD");
  add("old", "oldTokenVolume.minLiquidityUsd", "Minimum likuiditas", ["10000", "20000", "50000"], "USD");
  add("old", `oldTokenVolume.${feeKey}`, "Minimum total fees", fees, native);
  add("old", "oldTokenVolume.spikeMultiplier", "Minimum lonjakan", ["2", "3", "5"], "x");
  add("old", "oldTokenVolume.cooldownMin", "Cooldown", ["30", "60", "120"], "menit");
}

export function configValue(config: AlertConfig, field: ConfigField): number | boolean {
  let value: unknown = config;
  for (const part of field.path.split(".")) value = (value as Record<string, unknown>)[part];
  return value as number | boolean;
}

export function displayConfigValue(value: number | boolean, field: ConfigField): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (value === 0 && field.label === "Minimum total fees") return "Nonaktif";
  const formatted = value >= 1e12 || (value > 0 && value < 1e-6) ? String(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 20 });
  return `${formatted}${field.unit ? ` ${field.unit}` : ""}`;
}
