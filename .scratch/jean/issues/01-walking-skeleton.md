# 01: Walking skeleton

**What to build:** A local dev environment where the SPA renders a value fetched from the api through a type shared between them, backed by a real Postgres with the Admin already seeded. Proves the whole stack end to end before any feature lands.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `pnpm dev` starts api and web together; the SPA renders a health value fetched from the api
- [ ] api and web consume one shared zod schema for that payload, so changing it breaks both builds
- [ ] A Drizzle migration creates the `users` table (see `docs/PLAN.md` schema)
- [ ] The Admin is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` with an argon2id hash, only when `users` is empty
- [ ] Every env var in `docs/PLAN.md` is validated at api boot; a missing required one fails fast with a clear message
- [ ] `pnpm test` runs Vitest and passes
