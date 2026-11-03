# 10: Deploy

**What to build:** The whole product runs from `docker compose up` on a clean volume — SPA served, api migrated and seeded, ready for a domain.

**Blocked by:** 09 (Admin users)

**Status:** resolved

- [x] The web image serves the built SPA and proxies `/api` to the api service
- [x] `compose.yml` runs web, api and postgres with healthchecks, a named volume and `env_file`
- [x] The api migrates and seeds on boot, and a restart against an existing volume is a no-op
- [x] `compose.tls.yml` adds Caddy for `DOMAIN`, reverse-proxying web
- [x] From a clean volume, `docker compose up` yields a working login, invite, catalog and streaming chat
- [x] Nothing in the compose path requires TLS locally; the overlay is the only TLS path

## Answer

Added deploy scaffolding on top of issue 09:
- `apps/api/Dockerfile` — builds shared, runs `tsx src/index.ts` (migrate + seed on boot), healthcheck on `/api/health`, listens on `0.0.0.0`.
- `apps/web/Dockerfile` + `apps/web/nginx.conf` — multi-stage: builds shared + SPA with vite, nginx serves the SPA with SPA fallback and proxies `/api` to `api:3000` (buffering off for SSE streaming).
- `compose.yml` — web, api, postgres; healthchecks; named volume `jean_postgres_data`; `env_file: .env`; api overrides `DATABASE_URL` to the `postgres` service and `HOST=0.0.0.0`; ordered `depends_on` with `service_healthy`.
- `compose.tls.yml` + `Caddyfile` — Caddy reverse-proxying `web:80` for `${DOMAIN}` on 80/443.
- `.dockerignore`, `pnpm-workspace.yaml` (`allowBuilds` for argon2/esbuild).
- `apps/api/src/env.ts`/`index.ts` — `HOST` env (default `127.0.0.1`) used for the listen host.

Verified end-to-end against running compose: clean-volume up → login (200), `/api/auth/me`, invite create/validate/accept, catalog (`/api/models`), thread create, SSE endpoint wired; restart against existing volume is a no-op (no duplicate users); cookie is not `Secure` so local HTTP works; TLS is opt-in via the overlay. `pnpm typecheck` and `pnpm test` (107 tests) pass.
