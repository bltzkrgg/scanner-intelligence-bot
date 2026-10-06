import { integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const tokenSnapshots = pgTable("token_snapshots", {
  mint: text("mint").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  marketCapUsd: numeric("market_cap_usd").notNull(),
  liquidityUsd: numeric("liquidity_usd").notNull(),
  ageMinutes: integer("age_minutes").notNull(),
  payload: jsonb("payload").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
});

export const intelligenceReports = pgTable("intelligence_reports", {
  id: text("id").primaryKey(),
  mint: text("mint").notNull(),
  classification: text("classification").notNull(),
  historicalScore: integer("historical_score").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
