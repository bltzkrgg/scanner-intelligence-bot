import type { GmgnAdapter } from "./types.js";
import { CliGmgnAdapter } from "./client.js";
import { FixtureGmgnAdapter } from "./fixture.js";

export function createGmgnAdapter(provider: "mock" | "cli"): GmgnAdapter {
  if (provider === "cli") {
    return new CliGmgnAdapter();
  }

  return new FixtureGmgnAdapter();
}
