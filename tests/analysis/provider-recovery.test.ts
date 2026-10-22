import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@sti/shared";
import { ProviderHttp } from "../../packages/gmgn/src/http.js";
import { createCurlFetcher } from "../../packages/gmgn/src/curl-fetch.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { applyHolderAnalysis } from "../../packages/gmgn/src/client.js";
import { live, mint, otherMint, evm } from "./live-fixtures.js";

afterEach(() => vi.restoreAllMocks());
function curlMock(output: string, exit = 0) {
  let configuration = "";
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new Writable({ write(chunk, _encoding, done) { configuration += chunk.toString(); done(); },
      final(done) { queueMicrotask(() => { child.stdout.end(output); child.emit("close", exit); }); done(); } }),
    kill: vi.fn(() => true) });
  const start = vi.fn((..._args: unknown[]) => child);
  return { start, configuration: () => configuration, fetch: createCurlFetcher(start as never) };
}

describe("verified GET transport recovery", () => {
  it("recovers Node connection failures via curl and reuses the working transport for five minutes", async () => {
    const primary = vi.fn(async () => { throw new TypeError("SECRET", { cause: { code: "ECONNRESET" } }); });
    const recovery = vi.fn(async () => Response.json({ ok: true }));
    const http = new ProviderHttp("FOMO", "https://example.test", { authorization: "Bearer SECRET" }, 1000,
      primary as typeof fetch, recovery as typeof fetch);
    expect(await http.request("/first")).toEqual({ ok: true });
    expect(await http.request("/second")).toEqual({ ok: true });
    expect(primary).toHaveBeenCalledOnce();
    expect(recovery).toHaveBeenCalledTimes(2);
  });

  it("never retries denied HTTP access or POST operations through another transport", async () => {
    const recovery = vi.fn(async () => Response.json({ fake: true }));
    const denied = new ProviderHttp("Tracker", "https://example.test", {}, 1000,
      (async () => new Response("denied", { status: 403 })) as typeof fetch, recovery as typeof fetch);
    await expect(denied.request("/data")).rejects.toThrow("HTTP 403");
    const post = new ProviderHttp("Helius", "https://example.test", {}, 1000,
      (async () => { throw new Error("SECRET"); }) as typeof fetch, recovery as typeof fetch);
    await expect(post.request("", { method: "getAccountInfo" })).rejects.toThrow("koneksi/query gagal");
    expect(recovery).not.toHaveBeenCalled();
  });

  it("keeps curl TLS verification enabled and credentials out of argv", async () => {
    const curl = curlMock('{"value":1}\n200\napplication/json');
    const response = await curl.fetch("https://api.example.test/data", { headers: { authorization: "Bearer SECRET" } });
    expect(await response.json()).toEqual({ value: 1 });
    expect(curl.configuration()).toContain("Bearer SECRET");
    const argv = curl.start.mock.calls[0][1] as string[];
    expect(argv[0]).toBe("--disable");
    expect(argv).not.toContain("--insecure"); expect(argv).not.toContain("-k"); expect(argv).not.toContain("--location");
    expect(JSON.stringify(argv)).not.toContain("SECRET");
    expect(argv).toContain("=https");
  });

  it("surfaces curl SSL failure without leaking stderr, and does not follow redirects", async () => {
    const failed = curlMock("SECRET", 60);
    await expect(failed.fetch("https://api.example.test/data")).rejects.toThrow("exit 60");
    const redirect = curlMock("\n302\ntext/html");
    const response = await redirect.fetch("https://api.example.test/data");
    expect(response.status).toBe(302);
    expect(redirect.start).toHaveBeenCalledOnce();
  });

  it("rejects non-HTTPS, credentialed URLs, POST and pre-aborted requests before invoking curl", async () => {
    const curl = curlMock("\n200\napplication/json");
    for (const url of ["http://example.test", "https://user:SECRET@example.test"]) await expect(curl.fetch(url)).rejects.toThrow();
    await expect(curl.fetch("https://example.test", { method: "POST", body: "SECRET" })).rejects.toThrow();
    await expect(curl.fetch("https://example.test", { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(curl.start).not.toHaveBeenCalled();
  });
});

describe("provider payload and authentication fixes", () => {
  it("normalizes surrounding key whitespace and a pasted Bearer prefix without duplicating it", async () => {
    const c = loadConfig({ SOLANA_TRACKER_API_KEY: "  TRACKER  ", FOMO_API_KEY: " Bearer SECRET ", MADEONSOL_API_KEY: " Bearer MADE " });
    expect(c.solanaTrackerApiKey).toBe("TRACKER"); expect(c.fomoApiKey).toBe("SECRET"); expect(c.madeonsolApiKey).toBe("MADE");
    const headers: HeadersInit[] = [];
    await new EnrichedAdapter({ getTokenSnapshot: async () => live() }, loadConfig({ FOMO_API_KEY: " Bearer SECRET " }),
      (async (_url, options) => { headers.push(options!.headers!); return Response.json({ window: "7d", capturedAt: new Date().toISOString(), traders: [] }); }) as typeof fetch)
      .getTokenSnapshot(mint);
    expect(new Headers(headers[0]).get("authorization")).toBe("Bearer SECRET");
  });

  it("reads documented native_transfer.address and retains valid rows when other rows are malformed", () => {
    const s = live();
    applyHolderAnalysis(s, { list: [
      { address: otherMint, addr_type: "0", amount_percentage: "0.03", native_transfer: { address: mint } },
      { address: "11111111111111111111111111111111", addr_type: 0, amount_percentage: 0.02, native_transfer: { address: mint } },
      { address: "", addr_type: null, amount_percentage: null },
      { address: evm, addr_type: 0, amount_percentage: 0.2 },
      { address: mint, addr_type: 2, amount_percentage: 0.3 }
    ] }, "sol");
    expect(s.intelligence!.topHolderPcts).toEqual([3, 2]);
    expect(s.intelligence!.linkedFundingPct).toBe(5);
    expect(s.dataWarnings!.join(" ")).toContain("cakupan holder parsial");
  });

  it("does not infer a funder when two valid funding fields conflict, or a supply ratio is invalid", () => {
    const s = live();
    applyHolderAnalysis(s, [{ address: otherMint, addr_type: 0, amount_percentage: 0.03,
      native_transfer: { address: mint, from_address: "11111111111111111111111111111111" } }], "sol");
    expect(s.intelligence!.linkedFundingPct).toBeNull();
    expect(() => applyHolderAnalysis(live(), [{ address: otherMint, addr_type: 0, amount_percentage: 30 }], "sol")).toThrow();
  });

  it("handles an explicitly unindexed MadeOnSol deployer as missing data, not parser failure or zero", async () => {
    const base = { getTokenSnapshot: async () => { const s = live(); s.intelligence!.deployer = mint; return s; } };
    const s = await new EnrichedAdapter(base, loadConfig({ MADEONSOL_API_KEY: "SECRET" }),
      (async () => Response.json({ is_deployer: false, deployer: null, pump_tokens: [] })) as typeof fetch).getTokenSnapshot(mint);
    expect(s.intelligence!.developerBondedCount).toBeNull();
    expect(s.intelligence!.unavailable.developer).toContain("belum mempunyai histori deployer");
    expect(s.dataWarnings!.join(" ")).not.toContain("format respons");
  });

  it("does not fetch Tracker bundlers or replace GMGN activity with Tracker supply percentages", async () => {
    const request = vi.fn(async (input: string | URL | Request) => Response.json(String(input).endsWith("/bundlers")
      ? { total: 2, percentage: 6.73, wallets: [] }
      : { token: { mint }, pools: [{ tokenAddress: mint, market: "PumpSwap", liquidity: { usd: 100000 }, lastUpdated: Date.now() }],
        risk: { snipers: { totalPercentage: 0 } } }));
    const s = await new EnrichedAdapter({ getTokenSnapshot: async () => live() }, loadConfig({ SOLANA_TRACKER_API_KEY: "SECRET" }), request as typeof fetch)
      .getTokenSnapshot(mint);
    expect(s.bundlerPct).toBeNull(); expect(s.sniperPct).toBeNull();
    expect(s.intelligence!.sniperWalletCount).toBe(99);
    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0][0])).not.toContain("/bundlers");
    expect(s.intelligence!.sources).toEqual(["GMGN", "Solana Tracker"]);
  });
});
