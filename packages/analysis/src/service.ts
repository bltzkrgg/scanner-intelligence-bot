import benchmarkFixture from "../../../research/data/benchmark.fixture.json" with { type: "json" };
import type { GmgnAdapter } from "@sti/gmgn";
import type { BenchmarkToken, IntelligenceResult } from "@sti/shared";
import { solanaMintSchema } from "@sti/shared";
import { analyzeToken } from "./score.js";

export class IntelligenceScanner {
  constructor(
    private readonly gmgn: GmgnAdapter,
    private readonly benchmark: BenchmarkToken[] = benchmarkFixture as BenchmarkToken[]
  ) {}

  async scan(mintInput: string): Promise<IntelligenceResult> {
    const mint = solanaMintSchema.parse(mintInput);
    const snapshot = await this.gmgn.getTokenSnapshot(mint);
    return analyzeToken(snapshot, this.benchmark);
  }
}
