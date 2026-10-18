import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramStartupChatId: z.union([z.literal(""), z.string().regex(/^-?[1-9]\d*$/)]).optional(),
  gmgnProvider: z.enum(["mock", "cli"]).default("mock"),
  gmgnApiKey: z.string().optional(),
  runnerEnabled: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  runnerIntervalSeconds: z.coerce.number().int().min(60).max(86400).default(300),
  runnerStateFile: z.string().min(1).default("data/runners.json"),
  telegramAdminIds: z.string().regex(/^(?:[1-9]\d*(?:,[1-9]\d*)*)?$/).default("")
    .transform((value) => value ? value.split(",") : []),
  logLevel: z.string().default("info")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramStartupChatId: env.TELEGRAM_STARTUP_CHAT_ID,
    gmgnProvider: env.GMGN_PROVIDER,
    gmgnApiKey: env.GMGN_API_KEY,
    runnerEnabled: env.RUNNER_ENABLED,
    runnerIntervalSeconds: env.RUNNER_INTERVAL_SECONDS,
    runnerStateFile: env.RUNNER_STATE_FILE,
    telegramAdminIds: env.TELEGRAM_ADMIN_IDS,
    logLevel: env.LOG_LEVEL
  });
}
