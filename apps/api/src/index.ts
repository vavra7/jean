import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env", import.meta.url) });
import { loadEnv } from "./env.js";
import { initPool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { seedAdmin, seedDefaultScaffold } from "./db/seed.js";
import { registerAuthRoutes } from "./auth.js";
import { registerInvitesRoutes } from "./invites.js";
import { registerHealth } from "./routes/health.js";
import { registerModelsRoutes } from "./routes/models.js";
import { registerThreadsRoutes } from "./routes/threads.js";
import { registerMessagesRoutes } from "./routes/messages.js";
import { registerPersonaRoutes } from "./routes/persona.js";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";

const env = loadEnv();
initPool(env.DATABASE_URL);

const app = fastify({ logger: false });
app.register(fastifyCookie);
registerHealth(app);
registerAuthRoutes(app);
registerInvitesRoutes(app);
registerModelsRoutes(app);
registerThreadsRoutes(app);
registerMessagesRoutes(app);
registerPersonaRoutes(app);

await migrate();
await seedAdmin();
await seedDefaultScaffold();

await app.listen({ port: Number(env.PORT), host: "127.0.0.1" });

console.log(`[api] listening on http://127.0.0.1:${env.PORT}`);
