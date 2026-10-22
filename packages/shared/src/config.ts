import { z } from "zod";
import { chainSchema } from "./chains.js";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramStartupChatId: z.union([z.literal(""), z.string().regex(/^-?[1-9]\d*$/)]).optional(),
  telegramRunnerChatId: z.union([z.literal(""), z.string().regex(/^-?[1-9]\d*$/)]).optional(),
  enabledChains: z.string().default("sol,bsc,robinhood")
    .transform((value) => [...new Set(value.split(",").map((part) => chainSchema.parse(part.trim())))])
    .refine((value) => value.length > 0),
  gmgnProvider: z.enum(["mock", "cli"]).default("mock"),
  gmgnApiKey: z.string().optional(),
  gmgnHolderAnalysisEnabled: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  solanaTrackerApiKey: z.string().trim().optional(),
  heliusApiKey: z.string().optional(),
  madeonsolApiKey: z.string().transform((v) => v.trim().replace(/^Bearer\s+/i, "").trim()).optional(),
  fomoApiKey: z.string().transform((v) => v.trim().replace(/^Bearer\s+/i, "").trim()).optional(),
  madeonsolEnabled: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  fomoEnabled: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  fomoLeaderboardWindow: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
  enrichmentCacheSec: z.coerce.number().int().min(30).max(3600).default(300),
  runnerEnabled: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  runnerIntervalSeconds: z.coerce.number().int().min(60).max(86400).default(300),
  runnerStateFile: z.string().min(1).default("data/runners.json"),
  botShutdownTimeoutSec: z.coerce.number().int().min(10).max(120).default(25),
  botHealthEnabled: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  botHealthHost: z.string().min(1).default("127.0.0.1"),
  botHealthPort: z.coerce.number().int().min(1).max(65535).default(3101),
  botHealthToken: z.string().optional(),
  telegramAdminIds: z.string().regex(/^(?:[1-9]\d*(?:,[1-9]\d*)*)?$/).default("")
    .transform((value) => value ? value.split(",") : []),
  logLevel: z.string().default("info")
}).superRefine((config, ctx) => {
  if (config.botHealthEnabled && (!config.botHealthToken || config.botHealthToken.length < 32)) {
    ctx.addIssue({ code: "custom", path: ["botHealthToken"], message: "BOT_HEALTH_TOKEN minimal 32 karakter jika health endpoint aktif." });
  }
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramStartupChatId: env.TELEGRAM_STARTUP_CHAT_ID,
    telegramRunnerChatId: env.TELEGRAM_RUNNER_CHAT_ID,
    enabledChains: env.ENABLED_CHAINS,
    gmgnProvider: env.GMGN_PROVIDER,
    gmgnApiKey: env.GMGN_API_KEY,
    gmgnHolderAnalysisEnabled: env.GMGN_HOLDER_ANALYSIS_ENABLED,
    solanaTrackerApiKey: env.SOLANA_TRACKER_API_KEY,
    heliusApiKey: env.HELIUS_API_KEY,
    madeonsolApiKey: env.MADEONSOL_API_KEY,
    fomoApiKey: env.FOMO_API_KEY,
    madeonsolEnabled: env.MADEONSOL_ENABLED,
    fomoEnabled: env.FOMO_ENABLED,
    fomoLeaderboardWindow: env.FOMO_LEADERBOARD_WINDOW,
    enrichmentCacheSec: env.ENRICHMENT_CACHE_SEC,
    runnerEnabled: env.RUNNER_ENABLED,
    runnerIntervalSeconds: env.RUNNER_INTERVAL_SECONDS,
    runnerStateFile: env.RUNNER_STATE_FILE,
    botShutdownTimeoutSec: env.BOT_SHUTDOWN_TIMEOUT_SEC,
    botHealthEnabled: env.BOT_HEALTH_ENABLED,
    botHealthHost: env.BOT_HEALTH_HOST,
    botHealthPort: env.BOT_HEALTH_PORT,
    botHealthToken: env.BOT_HEALTH_TOKEN,
    telegramAdminIds: env.TELEGRAM_ADMIN_IDS,
    logLevel: env.LOG_LEVEL
  });
}
