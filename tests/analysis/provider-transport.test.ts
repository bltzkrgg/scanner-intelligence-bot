import { describe, expect, it, vi } from "vitest";
import { ProviderHttp, transportFailureReason } from "../../packages/gmgn/src/http.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { loadConfig } from "@sti/shared";
import { live, mint } from "./live-fixtures.js";
import { formatTelegramRisk } from "../../packages/report/src/telegram.js";
import { IntelligenceScanner } from "@sti/analysis";

describe("safe provider transport diagnostics", () => {
  it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_INVALID_CHAR"])(
    "retains only allowlisted nested transport code %s", (code) => {
      const nested = Object.assign(new Error("SECRET https://private.invalid"), { code });
      const error = new TypeError("fetch failed SECRET", { cause: nested });
      expect(transportFailureReason(error)).toContain(code);
      expect(transportFailureReason(error)).not.toMatch(/SECRET|https:/);
    });

  it("handles aggregate and cyclic causes without leaking arbitrary codes or messages", () => {
    const error = new AggregateError([Object.assign(new Error("SECRET"), { code: "ENETUNREACH" }),
      Object.assign(new Error("SECRET"), { code: "ETIMEDOUT" }), { code: "SECRET" }], "SECRET");
    error.cause = error;
    const result = transportFailureReason(error);
    expect(result).toContain("ENETUNREACH"); expect(result).toContain("ETIMEDOUT");
    expect(result).not.toContain("SECRET");
    expect(transportFailureReason({ code: "SECRET", message: "SECRET" })).not.toContain("SECRET");
    expect(transportFailureReason(new AggregateError([
      { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }, { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" },
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" }
    ])).length).toBeLessThanOrEqual(160);
  });

  it("reports redirects without following or revealing the destination", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.invalid?key=SECRET" } }));
    const http = new ProviderHttp("FOMO", "https://api.example", { authorization: "Bearer SECRET" }, 1000, fetcher as typeof fetch);
    const error = await http.request("/data").catch((e: Error) => e);
    expect((error as Error).message).toContain("HTTP 302: redirect ditolak");
    expect((error as Error).message).not.toMatch(/evil|SECRET/);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("https://api.example/data", expect.objectContaining({ redirect: "manual" }));
  });

  it.each([["text/html", "HTML"], ["application/json", "JSON"], ["application/problem+json", "JSON"], ["text/plain", "lain/tidak diketahui"]])(
    "classifies HTTP 403 content type %s without printing its body", async (type, label) => {
      const http = new ProviderHttp("Tracker", "https://example.invalid", {}, 1000,
        (async () => new Response("SECRET", { status: 403, headers: { "content-type": type } })) as typeof fetch);
      const error = await http.request("/data").catch((e: Error) => e);
      expect((error as Error).message).toContain(`HTTP 403: akses ditolak`);
      expect((error as Error).message).toContain(`Jenis respons: ${label}`);
      expect((error as Error).message).not.toContain("SECRET");
    });

  it.each(["leaderboard", "holders"])("identifies a failing FOMO %s request but keeps diagnostics out of Telegram risk notes", async (stage) => {
    const config = loadConfig({ FOMO_API_KEY: "SECRET" });
    const fetcher = (async (url: string) => {
      if (stage === "leaderboard" || url.includes("/holders")) {
        throw new TypeError("SECRET", { cause: Object.assign(new Error("SECRET"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }) });
      }
      return Response.json({ window: "7d", capturedAt: new Date().toISOString(), traders: [] });
    }) as typeof fetch;
    const adapter = new EnrichedAdapter({ getTokenSnapshot: async () => live() }, config, fetcher);
    const result = await new IntelligenceScanner(adapter).scan(mint);
    const reason = result.snapshot.intelligence!.unavailable.fomo!;
    expect(reason).toContain(stage === "leaderboard" ? "leaderboard 7d" : "token holders");
    expect(reason).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(reason).not.toContain("SECRET");
    expect(formatTelegramRisk(result)).not.toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(result.snapshot.intelligence!.fomo).toBeNull();
  });
});
