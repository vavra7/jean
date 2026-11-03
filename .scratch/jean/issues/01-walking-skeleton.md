# 01: Walking skeleton

**What to build:** A local dev environment where the SPA renders a value fetched from the api through a type shared between them, backed by a real Postgres with the Admin already seeded. Proves the whole stack end to end before any feature lands.

**Blocked by:** None (can start immediately)

**Status:** resolved

## Comments

Done: pnpm dev starts api (Fastify:3000) + web (Vite:5173, /api proxy); SPA renders `status: value` from GET /api/health ({"status":"ok","value":"jean is walking"}). One shared zod schema (@jean/shared HealthResponseSchema) consumed by api route + parse and web parse + type. Drizzle migration creates users table per docs/PLAN.md (citext email, pgcrypto+citext extensions) applied on boot. Admin seeded from ADMIN_EMAIL/ADMIN_PASSWORD with argon2id hash, only when users empty (idempotent). Every PLAN env var validated at boot via zod; missing required → exit 1 with clear message. pnpm test → Vitest, 4 tests pass. Verified end-to-end against docker postgres.

- [ ] `pnpm dev` starts api and web together; the SPA renders a health value fetched from the api
- [ ] api and web consume one shared zod schema for that payload, so changing it breaks both builds
- [ ] A Drizzle migration creates the `users` table (see `docs/PLAN.md` schema)
- [ ] The Admin is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` with an argon2id hash, only when `users` is empty
- [ ] Every env var in `docs/PLAN.md` is validated at api boot; a missing required one fails fast with a clear message
- [ ] `pnpm test` runs Vitest and passes
