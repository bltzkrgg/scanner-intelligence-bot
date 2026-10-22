import { z } from "zod";
import { base58AddressSchema, normalizeAddress } from "@sti/shared";
import { ProviderDataError, ProviderHttp, ProviderHttpError, providerFailureReason } from "./http.js";

export function createMadeOnSolHttp(key: string, ttlMs: number, fetcher: typeof fetch = fetch): ProviderHttp {
  return new ProviderHttp("MadeOnSol", "https://madeonsol.com/api/v1",
    { authorization: `Bearer ${key.trim().replace(/^Bearer\s+/i, "").trim()}` }, ttlMs, fetcher);
}

export function parseMadeOnSolDeployer(raw: unknown, wallet: string) {
  const total = z.number().int().nonnegative().safe();
  const data = z.object({ is_deployer: z.boolean().optional(), deployer: z.object({
    wallet_address: base58AddressSchema, total_tokens_deployed: total.nullish(), total_bonded: total.nullish()
  }).nullable() }).parse(raw);
  if (data.is_deployer === false && data.deployer === null) return null;
  const d = data.deployer;
  if (!d || data.is_deployer === false) throw new ProviderDataError("MadeOnSol: respons identitas deployer tidak konsisten.");
  if (d.wallet_address !== wallet) throw new ProviderDataError("MadeOnSol: identitas deployer berbeda dari permintaan.");
  if (d.total_tokens_deployed == null || d.total_bonded == null) {
    throw new ProviderDataError("MadeOnSol: total_tokens_deployed/total_bonded belum tersedia pada respons.");
  }
  if (d.total_bonded > d.total_tokens_deployed) throw new ProviderDataError("MadeOnSol: total bonded melebihi total deployed.");
  return { wallet_address: d.wallet_address, total_tokens_deployed: d.total_tokens_deployed, total_bonded: d.total_bonded };
}

const tier = z.enum(["BASIC", "PRO", "ULTRA", "BUSINESS", "ENTERPRISE"]);
const quotaWindow = z.object({
  limit: z.number().finite().nonnegative().optional(),
  used: z.number().finite().nonnegative().optional(),
  remaining: z.number().finite().nonnegative().optional()
});
const accountSchema = z.object({ tier, quota: z.object({ daily: quotaWindow, burst: quotaWindow }) });

export interface MadeOnSolCheckResult {
  endpoint: string;
  ok: boolean;
  data?: unknown;
  http?: number;
  reason?: string;
  details?: ProviderHttpError["details"];
}

// OpenAPI v1.20: /me is available on every authenticated tier. No identity/key output.
export async function checkMadeOnSol(key: string, chain: "sol" | "robinhood" = "sol", wallet?: string,
  fetcher: typeof fetch = fetch): Promise<MadeOnSolCheckResult[]> {
  if (!key.trim().replace(/^Bearer\s+/i, "").trim()) throw new ProviderDataError("MadeOnSol: MADEONSOL_API_KEY kosong.");
  const address = wallet === undefined ? undefined : normalizeAddress(wallet, chain);
  const http = createMadeOnSolHttp(key, 0, fetcher);
  const results: MadeOnSolCheckResult[] = [];
  const probe = async (path: string, parse: (raw: unknown) => unknown) => {
    try {
      results.push({ endpoint: path, ok: true, data: parse(await http.request(path)) });
      return true;
    } catch (error) {
      results.push({ endpoint: path, ok: false, reason: providerFailureReason("MadeOnSol", error),
        ...(error instanceof ProviderHttpError ? { http: error.status, details: error.details } : {}) });
      return false;
    }
  };
  if (!await probe("/me", (raw) => accountSchema.parse(raw))) return results;
  const prefix = chain === "robinhood" ? "/rhc" : "";
  if (!await probe(`${prefix}/kol/feed?limit=5`, (raw) => {
    const data = z.object({ trades: z.array(z.unknown()).max(5), delay_seconds: z.number().nonnegative().nullable().optional() }).parse(raw);
    if (chain === "robinhood") z.object({ chain: z.literal("robinhood") }).parse(raw);
    return { trades: data.trades.length, delaySeconds: data.delay_seconds };
  })) return results;
  if (address) await probe(`${prefix}/deployer-hunter/${address}`, (raw) => {
    if (chain === "sol") {
      const d = parseMadeOnSolDeployer(raw, address);
      return { indexed: d !== null, totalDeployed: d?.total_tokens_deployed ?? null, totalBonded: d?.total_bonded ?? null };
    }
    const data = z.object({ chain: z.literal("robinhood"), deployer: z.object({
      deployer_address: z.string(), tokens_deployed: z.number().int().nonnegative(), graduated: z.number().int().nonnegative()
    }) }).parse(raw);
    if (normalizeAddress(data.deployer.deployer_address, chain) !== address || data.deployer.graduated > data.deployer.tokens_deployed) {
      throw new ProviderDataError("MadeOnSol: identitas atau jumlah graduation RH tidak konsisten.");
    }
    return { totalDeployed: data.deployer.tokens_deployed, totalGraduated: data.deployer.graduated };
  });
  return results;
}
