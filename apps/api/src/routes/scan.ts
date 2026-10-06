import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IntelligenceScanner } from "@sti/analysis";
import { createGmgnAdapter } from "@sti/gmgn";
import { loadConfig } from "@sti/shared";

const requestSchema = z.object({
  mint: z.string()
});

export async function registerScanRoute(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const scanner = new IntelligenceScanner(createGmgnAdapter(config.gmgnProvider));

  app.post("/scan", async (request, reply) => {
    const body = requestSchema.parse(request.body);
    const result = await scanner.scan(body.mint);
    return reply.send(result);
  });
}
