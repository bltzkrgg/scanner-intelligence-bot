import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RunnerMonitor, formatRunnerNotification, type RunnerEvent } from "../../packages/analysis/src/runner.js";
import { runnerNotificationKeyboard } from "../../apps/telegram/src/handlers/report-keyboard.js";
import { live, evm } from "./live-fixtures.js";

const t = Date.parse("2026-10-18T10:27:26.478Z");
async function fixture() {
  const file = join(await mkdtemp(join(tmpdir(), "runner-format-")), "state.json");
  const adapter = { getTokenSnapshot: async () => live() };
  const monitor = new RunnerMonitor(adapter, file, true, ["sol", "bsc", "robinhood"]);
  await monitor.init();
  await monitor.observe({ ...live(), observedAt: new Date(t).toISOString() });
  return { file, adapter, monitor, event: monitor.snapshot().pendingAlerts[0] };
}

describe("structured Telegram runner alerts", () => {
  it("renders bold tree sections without Telegram code boxes or metadata footer", async () => {
    const { event } = await fixture();
    const text = formatRunnerNotification(event, t);
    expect(text).toContain("🟣 SOLANA TOKEN RUNNER");
    expect(text).toContain("┌ <b>MARKET</b>");
    expect(text).toContain("┌ <b>ACTIVITY</b>");
    expect(text).toContain("SOLANA QUALIFIED");
    expect(text).toContain("VOL • MC • FEES • AGE");
    expect(text).toContain("Flow 1h");
    expect(text).toContain("<b>Buy 68% • Sell 32%</b>");
    expect(text).toContain("20%");
    expect(text).toContain("12 SOL");
    expect(text).toContain("$1M");
    expect(text).toContain(`<b>CA</b>\n${event.record.mint}`);
    for (const removed of ["<pre>", "<code>", "Data event:", "Ref:", "N/A =", "Bukan rekomendasi beli/jual", "filter alert admin saat deteksi"]) {
      expect(text).not.toContain(removed);
    }
    for (const section of text.split("\n\n")) {
      const rows = section.split("\n").filter((line) => /^[├└] \w/.test(line) && line.includes(" : "));
      if (rows.length) expect(new Set(rows.map((line) => line.indexOf(" : "))).size).toBe(1);
    }
    expect(text).toMatch(/Dex Paid\s+: <b>N\/A<\/b>/);
    expect(text).toMatch(/Wallets\s+: <b>N\/A<\/b>/);
  });

  it("shows the old RH example as delayed history, not BSC-qualified or dollar-prefixed missing values", async () => {
    const { event } = await fixture();
    const old: RunnerEvent = { ...event, record: { ...event.record, chain: "robinhood", mint: evm,
      symbol: "MEME", qualification: "legacy", latestPrice: 0.011558842, marketCapUsd: 11558842,
      liquidityUsd: 1246726.32, volume5mUsd: null, swaps5m: null, totalFeesNative: null,
      feesNativeSymbol: null, dexAgeMinutes: null, buys1h: null, sells1h: null, top10HolderPct: null, smartMoneyHolderCount: null } };
    const text = formatRunnerNotification(old, t + 16 * 60000);
    expect(text).toContain("ROBINHOOD TOKEN RUNNER");
    expect(text).toContain("ALERT TERTUNDA");
    expect(text).toContain("HISTORI DETEKSI LAMA");
    expect(text).toContain("Filter RH terbaru\n   belum terverifikasi");
    expect(text).toContain("$0.01155884");
    expect(text).toContain("$11.56M");
    expect(text).toContain("$1.25M");
    expect(text).not.toContain("BSC");
    expect(text).not.toContain("QUALIFIED");
    expect(text).not.toMatch(/\$N\/A|N\/A (?:native|menit|ETH)|belum tersedia native/);
  });

  it("labels RH configured candidates with ETH and only the RH gates", async () => {
    const { event } = await fixture();
    const text = formatRunnerNotification({ ...event, record: { ...event.record, chain: "robinhood", mint: evm,
      feesNativeSymbol: "ETH", totalFeesNative: 0.1, dexAgeMinutes: null } }, t);
    expect(text).toContain("RH QUALIFIED");
    expect(text).toContain("0.1 ETH");
    expect(text).toContain("VOL • FEES");
    expect(text).not.toContain("• AGE");
  });

  it("does not claim qualification when required event metrics or native units are missing", async () => {
    const { event } = await fixture();
    for (const overrides of [{ volume5mUsd: null }, { totalFeesNative: null }, { dexAgeMinutes: null }, { feesNativeSymbol: null }]) {
      const text = formatRunnerNotification({ ...event, record: { ...event.record, ...overrides } }, t);
      expect(text).not.toContain("QUALIFIED");
      expect(text).toContain("DATA DETEKSI BELUM LENGKAP");
    }
    const text = formatRunnerNotification({ ...event, record: { ...event.record, chain: "bsc", feesNativeSymbol: "SOL" } }, t);
    expect(text).not.toContain("SOL QUALIFIED");
    expect(text).not.toContain("12 SOL");
  });

  it("preserves zero values, escapes HTML injection, and bounds long provider fields", async () => {
    const { event } = await fixture();
    const text = formatRunnerNotification({ ...event, record: { ...event.record, symbol: "<b>&fake</b>".repeat(100),
      riskNotes: Array(30).fill("<script>private & unsafe</script>".repeat(100)), volume5mUsd: 0, swaps5m: 0,
      totalFeesNative: 0, buys1h: 0, sells1h: 0, smartMoneyHolderCount: 0, top10HolderPct: 0 } }, t);
    expect(text).toContain("&lt;b&gt;&amp;fake&lt;/b&gt;");
    expect(text).not.toContain("<script>");
    expect(text).toMatch(/Flow 1h\s+: <b>N\/A<\/b>/);
    expect(text).toContain("<b>0%</b>");
    expect(text).toContain("0 SOL");
    expect(text.length).toBeLessThan(4096);
  });

  it("formats spike and milestone events without turning them into new-candidate qualification", async () => {
    const { event } = await fixture();
    const spike = { ...event, kind: "spike" as const, record: { ...event.record,
      qualification: "spike" as const, baselineVolume5mUsd: 40000, spikeMultiplier: 5 } };
    expect(formatRunnerNotification(spike, t)).toContain("SOLANA VOLUME SPIKE");
    expect(formatRunnerNotification(spike, t)).toContain("Lonjakan: 5x\n   Baseline: $40K");
    expect(formatRunnerNotification(spike, t)).not.toContain("Lonjakan saat event; baseline rata-rata 3 jendela 5m sebelumnya.");
    const missing = formatRunnerNotification({ ...spike, record: { ...spike.record, spikeMultiplier: null } }, t);
    expect(missing).toContain("Lonjakan: N/A\n");
    expect(missing).not.toContain("N/Ax");
    for (const kind of ["2x", "5x"] as const) {
      const text = formatRunnerNotification({ ...event, kind, record: { ...event.record, latestPrice: 5 } }, t);
      expect(text).toContain(`${kind.toUpperCase()} TERAMATI`);
      expect(text).toContain("5x dari deteksi");
      expect(text).not.toContain("QUALIFIED");
    }
  });

  it("does not invent flow from missing counts or zero activity", async () => {
    const { event } = await fixture();
    for (const counts of [{ buys1h: null, sells1h: 20 }, { buys1h: 20, sells1h: null }, { buys1h: 0, sells1h: 0 }]) {
      const text = formatRunnerNotification({ ...event, record: { ...event.record, ...counts } }, t);
      expect(text).toMatch(/Flow 1h\s+: <b>N\/A<\/b>/);
      expect(text).not.toContain("Buy ");
    }
    const text = formatRunnerNotification({ ...event, record: { ...event.record, buys1h: 0, sells1h: 5 } }, t);
    expect(text).toContain("Buy 0% • Sell 100%");
  });

  it("preserves small native fees and specific risk notes without restoring the generic footer", async () => {
    const { event } = await fixture();
    const text = formatRunnerNotification({ ...event, record: { ...event.record, chain: "bsc", feesNativeSymbol: "BNB",
      totalFeesNative: 0.00012345, riskNotes: ["Provider: honeypot belum dapat diperiksa."] } }, t);
    expect(text).toContain("0.00012345 BNB");
    expect(text).toContain("Provider: honeypot belum dapat diperiksa.");
    expect(text).not.toContain("Data event:");
  });

  it("fills missing old activity fields with null without rewriting the queued snapshot", async () => {
    const { monitor, file, adapter } = await fixture();
    const original = monitor.snapshot().pendingAlerts[0];
    const old = JSON.parse(await readFile(file, "utf8"));
    for (const record of [...old.records, ...old.pendingAlerts.map((event: RunnerEvent) => event.record)]) {
      delete record.buys1h; delete record.sells1h; delete record.top10HolderPct; delete record.smartMoneyHolderCount;
    }
    await writeFile(file, JSON.stringify(old));
    const restored = new RunnerMonitor(adapter, file, true);
    await restored.init();
    const queued = restored.snapshot().pendingAlerts[0];
    expect(queued.id).toBe(original.id);
    expect(queued.record.buys1h).toBeNull();
    expect(queued.record.lastSeenAt).toBe(original.record.lastSeenAt);
    expect(queued.record.latestPrice).toBe(original.record.latestPrice);
  });

  it("keeps only GMGN, runner detail and native copy for every chain", () => {
    for (const chain of ["sol", "bsc", "robinhood"] as const) {
      const mint = chain === "sol" ? live().mint : evm;
      const buttons = runnerNotificationKeyboard(chain, mint).inline_keyboard.flat();
      expect(buttons.map((button) => button.text)).toEqual(["GMGN", "Detail Runner", "Salin CA"]);
      expect(buttons[0]).toEqual({ text: "GMGN", url: `https://gmgn.ai/${chain}/token/${mint}` });
      expect(buttons[1]).toEqual({ text: "Detail Runner", callback_data: `report:r:${chain}:${mint}` });
      expect(buttons[2]).toEqual({ text: "Salin CA", copy_text: { text: mint } });
      expect(runnerNotificationKeyboard(chain, mint).inline_keyboard.map((row) => row.length)).toEqual([2, 1]);
      for (const button of buttons) if ("callback_data" in button) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it("uses wrapping text on mobile rather than a horizontally scrolling code block", async () => {
    const { event } = await fixture();
    const text = formatRunnerNotification({ ...event, kind: "spike", record: { ...event.record,
      qualification: "spike", latestPrice: 0.00018641, totalFeesNative: 23.88757287,
      buys1h: 12345678, sells1h: 87654321, baselineVolume5mUsd: 35860, spikeMultiplier: 3.21 } }, t);
    expect(text).not.toMatch(/<pre>|<code>/);
    expect(text).toContain("<b>23.89 SOL</b>");
    expect(text).toContain("Buy 12% • Sell 88%");
    expect(text).toContain("Lonjakan: 3.21x");
    expect(text).toContain("Baseline: $35.86K");
    expect(event.record.totalFeesNative).toBe(12);
  });
});
