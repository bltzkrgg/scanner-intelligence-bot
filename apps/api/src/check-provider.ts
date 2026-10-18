import { createGmgnAdapter, ProviderError } from "@sti/gmgn";
import { assessRunner } from "@sti/analysis";
import { loadConfig, parseTokenInput } from "@sti/shared";
import { providerDiagnostics } from "../../../packages/gmgn/src/diagnostics.js";

const config = loadConfig();
const adapter = createGmgnAdapter("cli", config);
const diagnostics = process.argv.includes("--diagnostics");
const text = process.argv.slice(2).filter((arg) => !["--discovery", "--diagnostics"].includes(arg)).join(" ") || "So11111111111111111111111111111111111111112";
if (diagnostics) console.log(JSON.stringify(providerDiagnostics(config), null, 2));
try {
  const input = parseTokenInput(text);
  if (!input?.chain) throw new ProviderError("Gunakan pnpm gmgn:check <sol|bsc|rh> <CA> [--discovery].");
  const snapshot = await adapter.getTokenSnapshot(input.mint, input.chain, { forceRefresh: diagnostics });
  const discovery = process.argv.includes("--discovery") ? await adapter.discoverTokens?.(input.chain) : undefined;
  console.log(JSON.stringify(diagnostics ? providerDiagnostics(config, snapshot) : { snapshot, runner: assessRunner(snapshot), discovery }, null, 2));
} catch (error) {
  console.error(error instanceof ProviderError ? error.message : "Data GMGN tidak cocok dengan schema atau CA tidak valid. Tidak memakai fallback fixture.");
  process.exitCode = 1;
}
