import type { GmgnAdapter } from "./types.js";
import { CliGmgnAdapter } from "./client.js";
import { FixtureGmgnAdapter } from "./fixture.js";
import type { AppConfig } from "@sti/shared";
import { EnrichedAdapter } from "./enrichment.js";

export function createGmgnAdapter(provider: "mock" | "cli", config?: AppConfig): GmgnAdapter {
  if (provider === "cli") {
    const base = new CliGmgnAdapter(undefined, 1200, config?.gmgnHolderAnalysisEnabled);
    return config ? new EnrichedAdapter(base, config) : base;
  }

  return new FixtureGmgnAdapter();
}
