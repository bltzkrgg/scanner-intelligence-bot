import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IntelligenceScanner } from "@sti/analysis";
import { createGmgnAdapter, ProviderError } from "@sti/gmgn";
import { loadConfig, tokenAddressSchema, chainSchema, base58AddressSchema, normalizeAddress } from "@sti/shared";

const requestSchema = z.object({
  mint: tokenAddressSchema,
  chain: chainSchema.optional()
});

export async function registerScanRoute(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const scanner = new IntelligenceScanner(createGmgnAdapter(config.gmgnProvider), undefined, config.enabledChains);

  app.post("/scan", async (request, reply) => {
    const body = requestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Kirim JSON dengan mint dan chain sol/bsc/robinhood yang valid." });
    const chain = body.data.chain ?? (base58AddressSchema.safeParse(body.data.mint).success ? "sol" : undefined);
    if (!chain) return reply.code(400).send({ error: "Alamat EVM memerlukan chain: bsc atau robinhood." });
    if (!config.enabledChains.includes(chain)) return reply.code(400).send({ error: "Jaringan belum diaktifkan." });
    try { normalizeAddress(body.data.mint, chain); }
    catch { return reply.code(400).send({ error: "Alamat tidak sesuai jaringan." }); }
    try {
      const result = await scanner.scan(body.data.mint, chain);
      return reply.send(result);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof ProviderError ? error.message : "Data provider belum bisa diproses." });
    }
  });
}
