import { loadConfig } from "@sti/shared";
import { checkMadeOnSol } from "../../../packages/gmgn/src/madeonsol.js";
import { ProviderHttpError, ProviderDataError } from "../../../packages/gmgn/src/http.js";

try {
  const [chain = "sol", wallet, ...extra] = process.argv.slice(2);
  if (!["sol", "rh", "robinhood"].includes(chain) || extra.length) {
    throw new ProviderDataError("Gunakan pnpm madeonsol:check [sol|rh] [WALLET_DEVELOPER, bukan CA].");
  }
  const config = loadConfig();
  const checks = await checkMadeOnSol(config.madeonsolApiKey ?? "", chain === "sol" ? "sol" : "robinhood", wallet);
  console.log(JSON.stringify({
    enrichmentEnabled: config.madeonsolEnabled,
    checks,
    note: "Tes akses langsung; tidak membutuhkan GMGN. HTTP 403 HTML tidak membuktikan key/paket salah."
  }, null, 2));
  if (checks.some((result) => !result.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof ProviderDataError || error instanceof ProviderHttpError ? error.message
    : "Konfigurasi/alamat tidak valid. Gunakan wallet developer sesuai chain; jangan bagikan API key.");
  process.exitCode = 1;
}
