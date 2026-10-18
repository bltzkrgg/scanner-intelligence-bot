import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../packages/shared/src/index.js";
import { ProviderHttp } from "../../packages/gmgn/src/http.js";
import { providerDiagnostics } from "../../packages/gmgn/src/diagnostics.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { applyHolderAnalysis, CliGmgnAdapter } from "../../packages/gmgn/src/client.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { formatTelegramRisk } from "../../packages/report/src/telegram.js";
import { live, mint, otherMint, info, security } from "./live-fixtures.js";

afterEach(() => vi.restoreAllMocks());
const base = () => ({ getTokenSnapshot: async () => live() });

describe("safe provider diagnostics", () => {
  it.each([[401, "key tidak diterima"], [402, "kredit/kuota habis"], [403, "akses ditolak"],
    [404, "tidak ditemukan"], [429, "rate limit"], [503, "query provider gagal"]])(
    "preserves HTTP %s without exposing response bodies or credentials", async (status, reason) => {
      const http = new ProviderHttp("FOMO", "https://example.test/?key=SECRET", { authorization: "Bearer SECRET" }, 1000,
        (async () => new Response("SECRET invalid key https://private.example", { status: Number(status) })) as typeof fetch);
      const error = await http.request("").catch((e: unknown) => e);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).toContain(reason);
      expect((error as Error).message).not.toMatch(/SECRET|https:\/\//);
    });

  it("separates timeout, connection and malformed JSON failures", async () => {
    for (const [fetcher, reason] of [
      [async () => { throw new DOMException("secret", "TimeoutError"); }, "timeout query"],
      [async () => { throw new Error("SECRET https://private.example"); }, "koneksi/query gagal"],
      [async () => new Response("SECRET not JSON", { status: 200 }), "bukan JSON valid"]
    ] as const) {
      const http = new ProviderHttp("Test", "https://example.test", {}, 1000, fetcher as typeof fetch);
      await expect(http.request("")).rejects.toThrow(reason);
    }
  });

  it("uses the five-minute default cooldown when Retry-After is missing", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi.fn(async () => new Response("secret", { status: 401 })) as unknown as typeof fetch;
    const http = new ProviderHttp("FOMO", "https://example.test", {}, 1000, fetcher);
    await expect(http.request("/a")).rejects.toThrow("HTTP 401");
    clock.mockReturnValue(61000);
    await expect(http.request("/b")).rejects.toThrow("cooldown setelah HTTP 401");
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(301000);
    await expect(http.request("/b")).rejects.toThrow("HTTP 401");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports only configuration presence and distinguishes missing keys from disabled providers", async () => {
    const config = loadConfig({ FOMO_API_KEY: "SECRET", FOMO_ENABLED: "false", MADEONSOL_ENABLED: "true" });
    const s = await new EnrichedAdapter(base(), config).getTokenSnapshot(mint);
    expect(s.intelligence!.unavailable.fomo).toBe("FOMO_ENABLED=false");
    expect(s.intelligence!.unavailable.developer).toContain("MADEONSOL_API_KEY kosong");
    const summary = providerDiagnostics(config, s);
    expect(summary.configuration.fomoKeyPresent).toBe(true);
    expect(summary.configuration.fomoEnabled).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("SECRET");
  });

  it("records HTTP failures and stale data as different FOMO unavailability reasons", async () => {
    const config = loadConfig({ FOMO_API_KEY: "SECRET" });
    const denied = await new EnrichedAdapter(base(), config,
      (async () => new Response("SECRET", { status: 402 })) as typeof fetch).getTokenSnapshot(mint);
    expect(denied.intelligence!.unavailable.fomo).toContain("HTTP 402");
    expect(denied.dataWarnings!.join(" ")).not.toContain("SECRET");
    const stale = await new EnrichedAdapter(base(), config, (async () => Response.json({
      window: "7d", capturedAt: "2020-01-01T00:00:00Z", traders: []
    })) as typeof fetch).getTokenSnapshot(mint);
    expect(stale.intelligence!.unavailable.fomo).toContain("timestamp leaderboard kedaluwarsa");
    expect(stale.intelligence!.fomo).toBeNull();
  });

  it("shows a missing deployer or missing provider totals instead of an unexplained developer N/A", async () => {
    const config = loadConfig({ MADEONSOL_API_KEY: "SECRET" });
    const missing = await new EnrichedAdapter(base(), config).getTokenSnapshot(mint);
    expect(missing.intelligence!.unavailable.developer).toContain("alamat deployer belum tersedia");
    const b = { getTokenSnapshot: async () => {
      const s = live(); s.intelligence!.deployer = mint; return s;
    } };
    const partial = await new EnrichedAdapter(b, config, (async () => Response.json({
      deployer: { wallet_address: mint, total_tokens_deployed: 5 }
    })) as typeof fetch).getTokenSnapshot(mint);
    expect(partial.intelligence!.unavailable.developer).toContain("total_tokens_deployed/total_bonded belum tersedia");
    expect(partial.intelligence!.developerBondedCount).toBeNull();
  });

  it("exposes schema field names but never rejected values in provider warnings", async () => {
    const config = loadConfig({ FOMO_API_KEY: "SECRET" });
    const adapter = new EnrichedAdapter(base(), config, (async () => Response.json({
      window: "7d", capturedAt: "SECRET", traders: "SECRET"
    })) as typeof fetch);
    const result = await new IntelligenceScanner(adapter).scan(mint);
    const reason = result.snapshot.intelligence!.unavailable.fomo;
    expect(reason).toContain("capturedAt");
    expect(reason).toContain("traders");
    expect(reason).not.toContain("SECRET");
    expect(formatTelegramRisk(result)).not.toContain("format respons API");
  });

  it("retains valid holder percentages when optional funding metadata is empty or invalid", () => {
    const s = live();
    applyHolderAnalysis(s, { list: [
      { address: otherMint, addr_type: 0, amount_percentage: 0.03, native_transfer: { from_address: "" } },
      { address: "11111111111111111111111111111111", addr_type: 0, amount_percentage: 0.02, native_transfer: null }
    ] }, "sol");
    expect(s.intelligence!.topHolderPcts).toEqual([3, 2]);
    expect(s.intelligence!.linkedFundingPct).toBeNull();
    expect(s.intelligence!.unavailable.linkedFunding).toContain("tidak menyertakan sumber pendanaan");
  });

  it("distinguishes a disabled holder query from unavailable funding metadata", async () => {
    const run = async (args: string[]) => args[1] === "security" ? security : info;
    const s = await new CliGmgnAdapter(run, 0).getTokenSnapshot(mint);
    expect(s.intelligence!.unavailable.linkedFunding).toBe("GMGN_HOLDER_ANALYSIS_ENABLED=false");
  });
});
