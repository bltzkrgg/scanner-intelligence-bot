import Fastify from "fastify";
import cors from "@fastify/cors";
import { logger, loadConfig } from "@sti/shared";
import { registerScanRoute } from "./routes/scan.js";

const config = loadConfig();
const app = Fastify({ loggerInstance: logger });

await app.register(cors);
await app.register(registerScanRoute);

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  logger.error({ error }, "API failed to start");
  process.exit(1);
});

logger.info({ port, env: config.nodeEnv }, "API started");
