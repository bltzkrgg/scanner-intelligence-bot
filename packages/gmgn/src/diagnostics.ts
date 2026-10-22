import type { AppConfig, MarketSnapshot } from "@sti/shared";

export function providerDiagnostics(config: AppConfig, snapshot?: MarketSnapshot) {
  return {
    runtime: { node: process.version, platform: process.platform, architecture: process.arch,
      extraCaConfigured: Boolean(process.env.NODE_EXTRA_CA_CERTS),
      proxyConfigured: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy),
      tlsVerificationDisabled: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" },
    configuration: {
      gmgnHolderAnalysisEnabled: config.gmgnHolderAnalysisEnabled,
      solanaTrackerKeyPresent: Boolean(config.solanaTrackerApiKey),
      heliusKeyPresent: Boolean(config.heliusApiKey),
      madeonsolEnabled: config.madeonsolEnabled, madeonsolKeyPresent: Boolean(config.madeonsolApiKey),
      fomoEnabled: config.fomoEnabled, fomoKeyPresent: Boolean(config.fomoApiKey),
      fomoLeaderboardWindow: config.fomoLeaderboardWindow
    },
    ...(snapshot ? {
      chain: snapshot.chain, mint: snapshot.mint, observedAt: snapshot.observedAt,
      sources: snapshot.intelligence?.sources ?? [],
      unavailable: snapshot.intelligence?.unavailable ?? {}, warnings: snapshot.dataWarnings ?? []
    } : {})
  };
}
