# 10: Deploy

**What to build:** The whole product runs from `docker compose up` on a clean volume — SPA served, api migrated and seeded, ready for a domain.

**Blocked by:** 09 (Admin users)

**Status:** ready-for-agent

- [ ] The web image serves the built SPA and proxies `/api` to the api service
- [ ] `compose.yml` runs web, api and postgres with healthchecks, a named volume and `env_file`
- [ ] The api migrates and seeds on boot, and a restart against an existing volume is a no-op
- [ ] `compose.tls.yml` adds Caddy for `DOMAIN`, reverse-proxying web
- [ ] From a clean volume, `docker compose up` yields a working login, invite, catalog and streaming chat
- [ ] Nothing in the compose path requires TLS locally; the overlay is the only TLS path
