import { existsSync } from "node:fs";
import { createApp } from "./app";
if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.VAULT_KEY;
if (!key)
  throw new Error(
    "VAULT_KEY is required. Copy .env.example to .env and generate a 32-byte hex key.",
  );
const { app } = await createApp({
  databasePath: process.env.DATABASE_PATH ?? "data/flowforge.sqlite",
  vaultKey: key,
  origin: process.env.PUBLIC_ORIGIN ?? "http://localhost:5173",
  secureCookies: process.env.COOKIE_SECURE === "true",
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  highWater: Number(process.env.QUEUE_HIGH_WATER ?? 1000),
  logger: true,
});
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
