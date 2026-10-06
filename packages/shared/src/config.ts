import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z.string().optional(),
  telegramBotToken: z.string().optional(),
  gmgnProvider: z.enum(["mock", "cli"]).default("mock"),
  gmgnApiKey: z.string().optional(),
  logLevel: z.string().default("info")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    gmgnProvider: env.GMGN_PROVIDER,
    gmgnApiKey: env.GMGN_API_KEY,
    logLevel: env.LOG_LEVEL
  });
}
