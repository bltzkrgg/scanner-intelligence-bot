import { describe, expect, it, vi } from "vitest";
import { CliGmgnAdapter, parseTokenInfo, parseTrending } from "../../packages/gmgn/src/client.js";
import { IntelligenceScanner } from "../../packages/analysis/src/service.js";
import { info, mint, otherMint, security } from "./live-fixtures.js";

describe("GMGN live mapping", () => {
  it("maps nested fields and distinguishes counts from supply percentages", () => {
    const snapshot = parseTokenInfo(info, mint, security);
    expect(snapshot.marketCapUsd).toBe(1000000);
    expect(snapshot.top10HolderPct).toBe(20);
    expect(snapshot.insiderPct).toBe(4);
    expect(snapshot.smartMoneyHolderCount).toBe(8);
    expect(snapshot.priceChange1hPct).toBe(25);
    expect(snapshot.sniperPct).toBeNull();
    expect(snapshot.bundlerPct).toBeNull();
    expect(snapshot.developerRugRatePct).toBeNull();
    const enveloped = parseTokenInfo({ code: 0, data: info }, mint, { code: 0, data: security });
    expect(enveloped.smartMoneyHolderCount).toBe(snapshot.smartMoneyHolderCount);
    expect(enveloped.insiderPct).toBe(4);
  });

  it("returns different live data for different addresses, without synthetic scores", async () => {
    const run = vi.fn(async (args: string[]) => args[1] === "security" ? security : {
      ...info, address: args[5], symbol: args[5] === mint ? "FIRST" : "SECOND",
      liquidity: args[5] === mint ? 75000 : 12000
    });
    const scanner = new IntelligenceScanner(new CliGmgnAdapter(run, 0));
    const a = await scanner.scan(mint);
    const b = await scanner.scan(otherMint);
    expect(a.snapshot.symbol).toBe("FIRST");
    expect(b.snapshot.symbol).toBe("SECOND");
    expect(a.snapshot.liquidityUsd).not.toBe(b.snapshot.liquidityUsd);
    expect(a.historicalScore).toBeNull();
    expect(b.similarWinRatePct).toBeNull();
    expect(b.warnings).toContain("Likuiditas rendah.");
  });

  it("leaves missing metrics null while preserving genuine zero", () => {
    const snapshot = parseTokenInfo({ address: mint, price: { buys_1h: 0 } }, mint);
    expect(snapshot.buys1h).toBe(0);
    expect(snapshot.liquidityUsd).toBeNull();
    expect(snapshot.priceUsd).toBeNull();
    expect(snapshot.dataWarnings).toContain("Data token security belum tersedia.");
  });

  it("rejects wrong CA, empty/error payloads, negative and nonfinite prices", () => {
    for (const data of [{}, { code: 401 }, { ...info, address: otherMint }, { ...info, price: { price: -1 } }, { ...info, price: { price: "NaN" } }]) {
      expect(() => parseTokenInfo(data, mint)).toThrow();
    }
  });

  it("deduplicates concurrent requests and caches the same CA", async () => {
    const run = vi.fn(async (args: string[]) => args[1] === "security" ? security : info);
    const adapter = new CliGmgnAdapter(run, 0);
    await Promise.all([adapter.getTokenSnapshot(mint), adapter.getTokenSnapshot(mint)]);
    await adapter.getTokenSnapshot(mint);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("bypasses the local cache on refresh without fabricating prices or timestamps", async () => {
    let price = "1";
    const run = vi.fn(async (args: string[]) => args[1] === "security" ? security : { ...info, price: { ...info.price, price } });
    const scanner = new IntelligenceScanner(new CliGmgnAdapter(run, 0));
    expect((await scanner.scan(mint)).snapshot.priceUsd).toBe(1);
    price = "2";
    expect((await scanner.scan(mint)).snapshot.priceUsd).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect((await scanner.scan(mint, "sol", { forceRefresh: true })).snapshot.priceUsd).toBe(2);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("stops requests on rate limits and never falls back to fixture", async () => {
    const run = vi.fn(async () => { throw new Error("429 RATE_LIMIT_BANNED secret-not-for-chat"); });
    const adapter = new CliGmgnAdapter(run, 0);
    await expect(adapter.getTokenSnapshot(mint)).rejects.toThrow("5 menit");
    await expect(adapter.getTokenSnapshot(otherMint)).rejects.toThrow("cooldown");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps basic data if security is unavailable", async () => {
    const adapter = new CliGmgnAdapter(async (args) => {
      if (args[1] === "security") throw new Error("unavailable");
      return info;
    }, 0);
    const snapshot = await adapter.getTokenSnapshot(mint);
    expect(snapshot.priceUsd).toBe(1);
    expect(snapshot.insiderPct).toBeNull();
  });

  it("validates discovery payloads and deduplicates addresses", () => {
    expect(parseTrending({ rank: [{ address: mint }, { address: mint }] })).toEqual([mint]);
    expect(parseTrending({ code: 0, data: { rank: [{ address: mint }] } })).toEqual([mint]);
    expect(() => parseTrending({ code: 403 })).toThrow();
  });

  it("accepts nullable security flags returned by CLI 1.6.7 and preserves unavailable insider data", () => {
    const snapshot = parseTokenInfo(info, mint, {
      top_10_holder_rate: "0.1811", is_honeypot: null, honeypot: 0,
      renounced_mint: true, renounced_freeze_account: true
    });
    expect(snapshot.insiderPct).toBeNull();
    expect(snapshot.top10HolderPct).toBeCloseTo(18.11);
    expect(snapshot.dataWarnings).not.toContain("Data token security belum tersedia.");
    expect(parseTokenInfo(info, mint, { honeypot: 1 }).dataWarnings).toContain("Provider menandai honeypot.");
  });
});
