import { CliGmgnAdapter, ProviderError } from "@sti/gmgn";
import { assessRunner } from "@sti/analysis";

const adapter = new CliGmgnAdapter();
const mint = process.argv[2] ?? "So11111111111111111111111111111111111111112";
try {
  const snapshot = await adapter.getTokenSnapshot(mint);
  const discovery = process.argv.includes("--discovery") ? await adapter.discoverTokens() : undefined;
  console.log(JSON.stringify({ snapshot, runner: assessRunner(snapshot), discovery }, null, 2));
} catch (error) {
  console.error(error instanceof ProviderError ? error.message : "Data GMGN tidak cocok dengan schema atau CA tidak valid. Tidak memakai fallback fixture.");
  process.exitCode = 1;
}
