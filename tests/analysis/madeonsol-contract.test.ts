import { describe, expect, it, vi, afterEach } from "vitest";
import { checkMadeOnSol, createMadeOnSolHttp, parseMadeOnSolDeployer } from "../../packages/gmgn/src/madeonsol.js";
import { ProviderHttpError } from "../../packages/gmgn/src/http.js";

const wallet = "So11111111111111111111111111111111111111112";
const rhWallet = "0x1111111111111111111111111111111111111111";
const account = { subscriber: "PRIVATE", tier: "BASIC", quota: { daily: { limit: 200, used: 3, remaining: 197 }, burst: {} } };
afterEach(() => vi.useRealTimers());

describe("MadeOnSol OpenAPI integration", () => {
  it("checks account, feed and the same Solana deployer contract used by enrichment", async () => {
    const request = vi.fn(async (url, options) => {
      expect(new Headers(options.headers).get("authorization")).toBe("Bearer msk_SECRET");
      expect(options.redirect).toBe("manual");
      return Response.json(String(url).endsWith("/me") ? account : String(url).includes("/kol/feed")
        ? { trades: [{ private: "SECRET" }], delay_seconds: 300 }
        : { is_deployer: true, deployer: { wallet_address: wallet, total_tokens_deployed: 10, total_bonded: 3 } });
    });
    const results = await checkMadeOnSol(" Bearer msk_SECRET ", "sol", wallet, request as typeof fetch);
    expect(results.map((r) => r.endpoint)).toEqual(["/me", "/kol/feed?limit=5", `/deployer-hunter/${wallet}`]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[2].data).toEqual({ indexed: true, totalDeployed: 10, totalBonded: 3 });
    expect(JSON.stringify(results)).not.toMatch(/PRIVATE|SECRET|Bearer/);
    expect(results[0].data).toEqual({ tier: "BASIC", quota: account.quota });
  });

  it("uses native RH routes and graduation counts, not Solana bonded counts", async () => {
    const request = vi.fn(async (url) => Response.json(String(url).endsWith("/me") ? account
      : String(url).includes("/kol/feed") ? { chain: "robinhood", trades: [], delay_seconds: null }
      : { chain: "robinhood", deployer: { deployer_address: rhWallet, tokens_deployed: 4, graduated: 2 } }));
    const results = await checkMadeOnSol("msk_SECRET", "robinhood", rhWallet, request as typeof fetch);
    expect(results[1].endpoint).toBe("/rhc/kol/feed?limit=5");
    expect(results[2].endpoint).toBe(`/rhc/deployer-hunter/${rhWallet}`);
    expect(results[2].data).toEqual({ totalDeployed: 4, totalGraduated: 2 });
  });

  it("stops after HTML denial and does not attribute it to a bad key, plan or WAF", async () => {
    const request = vi.fn(async () => new Response("<html>SECRET</html>", { status: 403, headers: { "content-type": "text/html" } }));
    const results = await checkMadeOnSol("msk_SECRET", "sol", wallet, request as typeof fetch);
    expect(request).toHaveBeenCalledOnce();
    expect(results[0]).toMatchObject({ endpoint: "/me", ok: false, http: 403, details: { format: "HTML" } });
    expect(results[0].reason).toContain("penyebab penolakan belum teridentifikasi");
    expect(JSON.stringify(results)).not.toMatch(/SECRET|WAF|periksa izin\/paket\/IP/);
  });

  it.each([
    ["tier_required", { your_tier: "BASIC", required_tier: "PRO" }],
    ["demo_key_endpoint_not_allowed", {}],
    ["origin_not_allowed", {}],
    ["origin_required", {}],
    ["Invalid or revoked API key", {}]
  ])("interprets official API denial %s without logging raw messages", async (code, fields) => {
    const http = createMadeOnSolHttp("msk_SECRET", 0, (async () => Response.json({
      error: code, ...fields, message: "Bearer msk_SECRET", private: "PRIVATE"
    }, { status: 403, headers: { "x-request-id": "req_123" } })) as typeof fetch);
    const error = await http.request("/me").catch((e) => e) as ProviderHttpError;
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.details).toMatchObject({ format: "JSON", requestId: "req_123",
      code: code === "Invalid or revoked API key" ? "invalid_or_revoked_key" : code });
    if (code === "tier_required") expect(error.details).toMatchObject({ yourTier: "BASIC", requiredTier: "PRO" });
    expect(error.message).not.toMatch(/SECRET|PRIVATE|Bearer/);
    await expect(http.request("/different")).rejects.toMatchObject({ details: error.details });
  });

  it("honors a short authentication-backend Retry-After and preserves its diagnosis", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(Response.json({ code: "auth_backend_unavailable" },
      { status: 503, headers: { "retry-after": "5" } })).mockResolvedValueOnce(Response.json(account));
    const http = createMadeOnSolHttp("msk_SECRET", 0, request as typeof fetch);
    await expect(http.request("/me")).rejects.toMatchObject({ details: { code: "auth_backend_unavailable" } });
    await expect(http.request("/me")).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5001);
    await expect(http.request("/me")).resolves.toMatchObject({ tier: "BASIC" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses quota reset on 429 when Retry-After is missing", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(Response.json({ error: "rate_limit_exceeded" }, { status: 429,
      headers: { "x-ratelimit-reset": String(Date.now() / 1000 + 7200) } })).mockResolvedValueOnce(Response.json(account));
    const http = createMadeOnSolHttp("msk_SECRET", 0, request as typeof fetch);
    await expect(http.request("/me")).rejects.toMatchObject({ details: { code: "rate_limit_exceeded" } });
    vi.advanceTimersByTime(3601000);
    await expect(http.request("/me")).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3600000);
    await expect(http.request("/me")).resolves.toMatchObject({ tier: "BASIC" });
  });

  it("rejects raw or credential-bearing request IDs, oversized and malformed error envelopes", async () => {
    for (const body of ['{"message":"msk_SECRET"}', '{"error":', "x".repeat(65537)]) {
      const http = createMadeOnSolHttp("msk_SECRET", 0, (async () => new Response(body, { status: 403,
        headers: { "content-type": "application/json", "x-request-id": "msk_SECRET" } })) as typeof fetch);
      await expect(http.request("/me")).rejects.toMatchObject({ details: { format: "JSON" } });
      const error = await http.request("/me").catch((e) => e) as ProviderHttpError;
      expect(error.details?.requestId).toBeUndefined();
      expect(error.message).not.toContain("msk_SECRET");
    }
  });

  it("keeps an unindexed deployer unknown and rejects contradictory identities/counts", () => {
    expect(parseMadeOnSolDeployer({ is_deployer: false, deployer: null }, wallet)).toBeNull();
    for (const d of [
      { wallet_address: wallet, total_tokens_deployed: 1, total_bonded: 2 },
      { wallet_address: rhWallet, total_tokens_deployed: 2, total_bonded: 1 },
      { wallet_address: wallet, total_tokens_deployed: 1, total_bonded: null }
    ]) expect(() => parseMadeOnSolDeployer({ is_deployer: true, deployer: d }, wallet)).toThrow();
  });

  it("validates input before sending any request and rejects non-account 200 bodies", async () => {
    const request = vi.fn(async () => Response.json({ tier: "invented", subscriber: "SECRET" }));
    await expect(checkMadeOnSol(" ", "sol", wallet, request as typeof fetch)).rejects.toThrow("kosong");
    await expect(checkMadeOnSol("msk_SECRET", "sol", rhWallet, request as typeof fetch)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const result = await checkMadeOnSol("msk_SECRET", "sol", undefined, request as typeof fetch);
    expect(result[0].ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(request).toHaveBeenCalledOnce();
  });
});
