import type { IntelligenceResult } from "@sti/shared";

export type ReportRepository = {
  save(result: IntelligenceResult): Promise<void>;
};

export class InMemoryReportRepository implements ReportRepository {
  private reports: IntelligenceResult[] = [];

  async save(result: IntelligenceResult): Promise<void> {
    this.reports.push(result);
  }

  all(): IntelligenceResult[] {
    return [...this.reports];
  }
}
