import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IntelligenceScanner } from "@sti/analysis";
import { createGmgnAdapter, ProviderError } from "@sti/gmgn";
import { loadConfig, solanaMintSchema } from "@sti/shared";

const requestSchema = z.object({
  mint: solanaMintSchema
});

export async function registerScanRoute(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const scanner = new IntelligenceScanner(createGmgnAdapter(config.gmgnProvider));

  app.post("/scan", async (request, reply) => {
    const body = requestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Kirim JSON dengan mint Solana yang valid." });
    try {
      const result = await scanner.scan(body.data.mint);
      return reply.send(result);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof ProviderError ? error.message : "Data provider belum bisa diproses." });
    }
  });
}
