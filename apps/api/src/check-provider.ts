import { CliGmgnAdapter, ProviderError } from "@sti/gmgn";
import { assessRunner } from "@sti/analysis";
import { parseTokenInput } from "@sti/shared";

const adapter = new CliGmgnAdapter();
const text = process.argv.slice(2).filter((arg) => arg !== "--discovery").join(" ") || "So11111111111111111111111111111111111111112";
try {
  const input = parseTokenInput(text);
  if (!input?.chain) throw new ProviderError("Gunakan pnpm gmgn:check <sol|bsc|rh> <CA> [--discovery].");
  const snapshot = await adapter.getTokenSnapshot(input.mint, input.chain);
  const discovery = process.argv.includes("--discovery") ? await adapter.discoverTokens(input.chain) : undefined;
  console.log(JSON.stringify({ snapshot, runner: assessRunner(snapshot), discovery }, null, 2));
} catch (error) {
  console.error(error instanceof ProviderError ? error.message : "Data GMGN tidak cocok dengan schema atau CA tidak valid. Tidak memakai fallback fixture.");
  process.exitCode = 1;
}
