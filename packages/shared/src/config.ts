import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z.string().optional(),
  telegramBotToken: z.string().optional(),
  telegramStartupChatId: z.union([z.literal(""), z.string().regex(/^-?[1-9]\d*$/)]).optional(),
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
    telegramStartupChatId: env.TELEGRAM_STARTUP_CHAT_ID,
    gmgnProvider: env.GMGN_PROVIDER,
    gmgnApiKey: env.GMGN_API_KEY,
    logLevel: env.LOG_LEVEL
  });
}
