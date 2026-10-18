import { describe, expect, it } from "vitest";
import { normalizeAddress, parseTokenInput, loadConfig } from "../../packages/shared/src/index.js";
import { CliGmgnAdapter, parseTokenInfo, parseTrending } from "../../packages/gmgn/src/client.js";
import { info, security, evm } from "./live-fixtures.js";

describe("multichain token identity", () => {
  it("requires an EVM chain selection and supports explicit aliases", () => {
    expect(parseTokenInput(evm)).toEqual({ mint: evm });
    expect(parseTokenInput(`rh ${evm}`)).toEqual({ mint: evm, chain: "robinhood" });
    expect(parseTokenInput(`bsc:${evm}`)).toEqual({ mint: evm, chain: "bsc" });
    expect(parseTokenInput(`sol ${evm}`)).toBeNull();
    expect(parseTokenInput("halo")).toBeNull();
    expect(() => normalizeAddress("wrong", "robinhood")).toThrow();
  });

  it("isolates the cache and normalizes EVM casing", async () => {
    const calls: string[][] = [];
    const adapter = new CliGmgnAdapter(async (args) => {
      calls.push(args);
      return args[1] === "security" ? { ...security, honeypot: 0, renounced_mint: false } : {
        ...info, address: evm, symbol: args[3] === "bsc" ? "BSC" : "RH"
      };
    }, 0);
    expect((await adapter.getTokenSnapshot(evm, "bsc")).symbol).toBe("BSC");
    const rh = await adapter.getTokenSnapshot(evm, "robinhood");
    expect(rh.symbol).toBe("RH");
    expect(rh.dataWarnings).not.toContain("Otoritas mint masih aktif menurut provider.");
    await adapter.getTokenSnapshot(evm, "bsc");
    expect(calls).toHaveLength(4);
    expect(parseTrending({ rank: [{ address: evm }] }, "robinhood")).toEqual([evm]);
  });

  it("does not score EVM tokens when honeypot data is unknown", () => {
    const snapshot = parseTokenInfo({ ...info, address: evm }, evm, security, Date.now(), "bsc");
    expect(snapshot.runnerBlockReason).toBe("Data security honeypot BSC belum tersedia.");
    const rh = parseTokenInfo({ ...info, address: evm }, evm, security, Date.now(), "robinhood");
    expect(rh.runnerBlockReason).toBeNull();
    expect(rh.dataWarnings?.join(" ")).toContain("Status honeypot RH belum tersedia");
  });

  it("defaults to all three networks and validates configured networks", () => {
    expect(loadConfig({}).enabledChains).toEqual(["sol", "bsc", "robinhood"]);
    expect(loadConfig({ ENABLED_CHAINS: "bsc, bsc,robinhood" }).enabledChains).toEqual(["bsc", "robinhood"]);
    expect(() => loadConfig({ ENABLED_CHAINS: "wrong" })).toThrow();
  });
});
