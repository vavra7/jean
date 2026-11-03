import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env", import.meta.url) });
import { loadEnv } from "./env.js";
import { initPool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { seedAdmin } from "./db/seed.js";
import { registerHealth } from "./routes/health.js";
import fastify from "fastify";

const env = loadEnv();
initPool(env.DATABASE_URL);

const app = fastify({ logger: false });
registerHealth(app);

await migrate();
await seedAdmin();

await app.listen({ port: Number(env.PORT), host: "127.0.0.1" });

console.log(`[api] listening on http://127.0.0.1:${env.PORT}`);
