import type { AppConfig, MarketSnapshot } from "@sti/shared";

export function providerDiagnostics(config: AppConfig, snapshot?: MarketSnapshot) {
  return {
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
