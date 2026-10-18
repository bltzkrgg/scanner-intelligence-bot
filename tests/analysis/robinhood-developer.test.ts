import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { loadConfig, tokenIntelligenceSchema } from "../../packages/shared/src/index.js";
import { EnrichedAdapter } from "../../packages/gmgn/src/enrichment.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { RunnerMonitor, formatRunnerNotification } from "../../packages/analysis/src/runner.js";
import { formatTelegramReport, formatTelegramRisk } from "../../packages/report/src/telegram.js";
import { live, evm } from "./live-fixtures.js";

const wallet = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const token2 = "0x2222222222222222222222222222222222222222";
const config = () => loadConfig({ MADEONSOL_API_KEY: "fake-key" });
const base = (deployer: string | null = wallet) => ({ getTokenSnapshot: async () => ({ ...live(),
  chain: "robinhood" as const, mint: evm, feesNativeSymbol: "ETH" as const, totalFeesNative: 0.1,
  intelligence: tokenIntelligenceSchema.parse({ deployer, sources: ["GMGN"] })
}) });
const profile = () => ({ chain: "robinhood", deployer: { deployer_address: wallet,
  tokens_deployed: 28, graduated: 9, graduation_rate: 0.321 } });
function fetcher(responses: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (!(path in responses)) return new Response("fake-secret", { status: 503 });
    return Response.json(responses[path]);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const path = `/api/v1/rhc/deployer-hunter/${wallet}`;

describe("MadeOnSol Robinhood developer", () => {
  it("shares graduated statistics between CA reports, persisted runner alerts and refresh", async () => {
    const http = fetcher({ [path]: profile() });
    const adapter = new EnrichedAdapter(base(), config(), http);
    const result = await new IntelligenceScanner(adapter).scan(evm, "robinhood");
    expect(result.snapshot.developerTokenCount).toBe(28);
    expect(result.snapshot.intelligence).toMatchObject({ developerGraduatedCount: 9,
      developerGraduationRatePct: 9 / 28 * 100, developerBondedCount: null, developerBondRatePct: null });
    for (const report of [formatTelegramReport(result), formatTelegramRisk(result)]) {
      expect(report).toContain("Graduated: 9");
      expect(report).toContain("32\\.14%");
      expect(report).not.toContain("Berhasil bond");
    }
    expect(formatTelegramRisk(result)).toContain("$40K");
    const file = join(await mkdtemp(join(tmpdir(), "rh-developer-")), "state.json");
    const runner = new RunnerMonitor(adapter, file, true, ["robinhood"]);
    await runner.init(); await runner.observe(result.snapshot);
    const event = runner.snapshot().pendingAlerts[0];
    expect(formatRunnerNotification(event)).toContain("Dev graduated");
    expect(formatRunnerNotification(event)).toContain("9 • 32.14%");
    expect(formatRunnerNotification(event)).not.toContain("Dev bonded");
    const restored = new RunnerMonitor(adapter, file, true, ["robinhood"]); await restored.init();
    expect(restored.snapshot().pendingAlerts[0]).toEqual(event);
    await adapter.getTokenSnapshot(evm, "robinhood"); expect(http).toHaveBeenCalledTimes(1);
    await adapter.getTokenSnapshot(evm, "robinhood", { forceRefresh: true }); expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[0][1].headers).toMatchObject({ authorization: "Bearer fake-key" });
  });

  it("resolves a missing deployer from RH token detail and handles checksummed wallet addresses", async () => {
    const http = fetcher({ [`/api/v1/rhc/tokens/${evm}`]: { chain: "robinhood", token: { address: evm,
      deployer: { address: `0x${wallet.slice(2).toUpperCase()}` } } }, [path]: profile() });
    const s = await new EnrichedAdapter(base(null), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.intelligence!.deployer).toBe(wallet);
    expect(s.intelligence!.developerGraduatedCount).toBe(9);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("counts a complete token page without inferring counts from rounded rates", async () => {
    const http = fetcher({ [path]: { chain: "robinhood", deployer: { deployer_address: wallet, graduation_rate: 0.5 } },
      [`${path}/tokens`]: { chain: "robinhood", address: wallet, is_deployer: true, total: 2,
        tokens: [{ address: evm, is_graduated: true }, { address: token2, is_graduated: false }] } });
    const s = await new EnrichedAdapter(base(), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.developerTokenCount).toBe(2);
    expect(s.intelligence!.developerGraduatedCount).toBe(1);
    expect(s.intelligence!.developerGraduationRatePct).toBe(50);
    expect(String(http.mock.calls[1][0])).toContain("limit=100&offset=0");
  });

  it("keeps partial counts unknown and preserves only the explicit provider graduation rate", async () => {
    const http = fetcher({ [path]: { chain: "robinhood", deployer: { deployer_address: wallet, graduation_rate: 0.321 } },
      [`${path}/tokens`]: { chain: "robinhood", address: wallet, is_deployer: true, total: 150,
        tokens: [{ address: evm, is_graduated: true }] } });
    const s = await new EnrichedAdapter(base(), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.developerTokenCount).toBe(150);
    expect(s.intelligence!.developerGraduatedCount).toBeNull();
    expect(s.intelligence!.developerGraduationRatePct).toBeCloseTo(32.1);
    expect(s.dataWarnings!.join(" ")).toContain("histori token parsial");
  });

  it("does not turn empty history into a zero-percent success rate", async () => {
    const http = fetcher({ [path]: { chain: "robinhood", deployer: { deployer_address: wallet,
      tokens_deployed: 0, graduated: 0, graduation_rate: 0 } } });
    const s = await new EnrichedAdapter(base(), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.developerTokenCount).toBe(0);
    expect(s.intelligence!.developerGraduatedCount).toBe(0);
    expect(s.intelligence!.developerGraduationRatePct).toBeNull();
  });

  it("does not substitute recent or duplicate tokens for complete history", async () => {
    for (const page of [undefined, { chain: "robinhood", address: wallet, is_deployer: true, total: 2,
      tokens: [{ address: evm, is_graduated: true }, { address: evm, is_graduated: true }] }]) {
      const http = fetcher({ [path]: { chain: "robinhood", deployer: { deployer_address: wallet, graduation_rate: 0.321 },
        recent_tokens: [{ address: evm, is_graduated: true }] },
        ...(page ? { [`${path}/tokens`]: page } : {}) });
      const s = await new EnrichedAdapter(base(), config(), http).getTokenSnapshot(evm, "robinhood");
      expect(s.developerTokenCount).toBeNull();
      expect(s.intelligence!.developerGraduatedCount).toBeNull();
      expect(s.intelligence!.developerGraduationRatePct).toBeCloseTo(32.1);
    }
    const old = tokenIntelligenceSchema.parse({ developerBondedCount: 3, developerBondRatePct: 25 });
    expect(old.developerGraduatedCount).toBeNull();
    expect(old.developerGraduationRatePct).toBeNull();
  });

  it("rejects wrong token/chain/deployer, impossible counts and invalid ratio units", async () => {
    for (const payload of [
      { ...profile(), chain: "sol" },
      { ...profile(), deployer: { ...profile().deployer, deployer_address: token2 } },
      { ...profile(), deployer: { ...profile().deployer, graduated: 29 } },
      { ...profile(), deployer: { ...profile().deployer, graduation_rate: 32.1 } }
    ]) {
      const s = await new EnrichedAdapter(base(), config(), fetcher({ [path]: payload })).getTokenSnapshot(evm, "robinhood");
      expect(s.intelligence!.developerGraduatedCount).toBeNull();
      expect(s.intelligence!.sources).not.toContain("MadeOnSol");
      expect(s.priceUsd).toBe(1);
    }
    const http = fetcher({ [`/api/v1/rhc/tokens/${evm}`]: { chain: "robinhood", token: { address: token2, deployer: { address: wallet } } } });
    const s = await new EnrichedAdapter(base(null), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.intelligence!.deployer).toBeNull(); expect(http).toHaveBeenCalledTimes(1);
  });

  it("retains market data on provider failures and respects disabled/missing keys", async () => {
    const http = fetcher({});
    const s = await new EnrichedAdapter(base(), config(), http).getTokenSnapshot(evm, "robinhood");
    expect(s.priceUsd).toBe(1); expect(s.intelligence!.developerGraduatedCount).toBeNull();
    expect(s.dataWarnings!.join(" ")).not.toContain("fake-secret");
    http.mockClear();
    for (const cfg of [loadConfig({}), loadConfig({ MADEONSOL_API_KEY: "fake", MADEONSOL_ENABLED: "false" })]) {
      await new EnrichedAdapter(base(), cfg, http).getTokenSnapshot(evm, "robinhood");
    }
    expect(http).not.toHaveBeenCalled();
  });
});
