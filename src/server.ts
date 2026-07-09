import { buildApp } from "./app.js";
import { logger } from "./shared/logger.js";

const PORT = Number(process.env.PORT ?? 3000);

const { express: app, db, cleanup } = await buildApp({ connectionString: process.env.DATABASE_URL });

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Ascend started");
});

// Drain in-flight requests on deploy or container stop.
// Gives handlers up to 10 s to finish; forces exit after the timeout.
function shutdown(signal: string): void {
  logger.info({ signal }, "shutdown signal received — draining");
  server.close(async () => {
    try {
      await cleanup();   // disconnect Redis event-bus subscriber
      await db.close();  // release Postgres pool
    } catch {
      // ignore cleanup errors — we're exiting anyway
    }
    logger.info("graceful shutdown complete");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
