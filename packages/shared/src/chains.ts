import { z } from "zod";

export const chainSchema = z.enum(["sol", "bsc", "robinhood"]);
export type Chain = z.infer<typeof chainSchema>;
export const CHAIN_NAMES: Record<Chain, string> = { sol: "Solana", bsc: "BSC", robinhood: "Robinhood Chain (RH)" };
export const evmAddressSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/);
export const base58AddressSchema = z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const tokenAddressSchema = z.union([evmAddressSchema, base58AddressSchema]);

export function normalizeAddress(address: string, chain: Chain): string {
  return chain === "sol" ? base58AddressSchema.parse(address) : evmAddressSchema.parse(address).toLowerCase();
}

export function parseChain(value: string): Chain | undefined {
  const alias: Record<string, Chain> = { sol: "sol", solana: "sol", bsc: "bsc", bnb: "bsc", rh: "robinhood", robinhood: "robinhood" };
  return alias[value.toLowerCase()];
}

export function parseTokenInput(text: string): { mint: string; chain?: Chain } | null {
  const parts = text.trim().replace(/^(sol|solana|bsc|bnb|rh|robinhood):/i, "$1 ").split(/\s+/);
  if (parts.length === 1) {
    if (base58AddressSchema.safeParse(parts[0]).success) return { mint: parts[0], chain: "sol" };
    if (evmAddressSchema.safeParse(parts[0]).success) return { mint: parts[0].toLowerCase() };
    return null;
  }
  const chain = parts.length === 2 ? parseChain(parts[0]) : undefined;
  if (!chain) return null;
  try { return { chain, mint: normalizeAddress(parts[1], chain) }; } catch { return null; }
}
