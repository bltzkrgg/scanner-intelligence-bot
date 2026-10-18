import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerScanRoute } from "../../apps/api/src/routes/scan.js";
import { mint, evm } from "./live-fixtures.js";

afterEach(() => vi.unstubAllEnvs());

describe("scan API", () => {
  it("returns null scores for demo data and rejects malformed inputs", async () => {
    vi.stubEnv("GMGN_PROVIDER", "mock");
    const app = Fastify();
    await app.register(registerScanRoute);
    try {
      const response = await app.inject({ method: "POST", url: "/scan", payload: { mint } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ historicalScore: null, classification: null, snapshot: { source: "fixture" } });
      for (const payload of [{}, { mint: "wrong" }, { mint: 42 }]) {
        const invalid = await app.inject({ method: "POST", url: "/scan", payload });
        expect(invalid.statusCode).toBe(400);
      }
      const ambiguous = await app.inject({ method: "POST", url: "/scan", payload: { mint: evm } });
      expect(ambiguous.statusCode).toBe(400);
      const bsc = await app.inject({ method: "POST", url: "/scan", payload: { mint: evm, chain: "bsc" } });
      expect(bsc.statusCode).toBe(200);
      expect(bsc.json().snapshot.chain).toBe("bsc");
    } finally { await app.close(); }
  });
});
