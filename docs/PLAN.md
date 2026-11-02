# Jean — build plan

Personal chat agent. Multi-user, invite-only, admin-owned model catalog, per-user persona document. TypeScript backend, Vite + React SPA. Deliberately no tools, no trimming, no revisions, no archiving.

See `GLOSSARY.md` for terms and `docs/adr/` for the decisions that will look wrong without context.

## Layout

```
apps/
  api/          Fastify, Drizzle, Postgres, provider adapters, SSE
  web/          Vite + React + Tailwind + shadcn/ui + React Router + TanStack Query
  nginx/        web image: serves built SPA, proxies /api → api
packages/
  shared/       zod schemas + DTO types shared by api and web
compose.yml         web, api, postgres (no TLS)
compose.tls.yml     overlay adding Caddy, needs DOMAIN
```

pnpm workspaces. Node 22. Turborepo not needed.

## Environment

| var | used by | default |
| --- | --- | --- |
| `DATABASE_URL` | api | — |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | api | — (seeded only when `users` is empty) |
| `SESSION_SECRET` | api | — (pepper for session token hashes) |
| `NVIDIA_API_KEY` | api | — |
| `NVIDIA_BASE_URL` | api | `https://integrate.api.nvidia.com/v1` |
| `OLLAMA_BASE_URL` | api | `http://localhost:11434` |
| `PUBLIC_ORIGIN` | api | `http://localhost:5173` (invite links) |
| `DOMAIN` | caddy overlay | — |

Providers are hardcoded in `apps/api/src/providers/`: `nvidia.ts`, `ollama.ts`, plus a registry map. Adding a provider is a code change, not config.

## Schema (Drizzle)

```sql
users(id uuid pk, email citext unique, display_name text, password_hash text,
      is_admin bool, last_model_provider text, last_model_external_id text, created_at timestamptz)

sessions(id uuid pk, user_id uuid fk→users on delete cascade, token_hash text unique,
         expires_at timestamptz, created_at timestamptz)

invites(id uuid pk, email citext, token_hash text unique, expires_at timestamptz,
        used_at timestamptz, created_by uuid fk→users on delete set null, created_at timestamptz)

models(id uuid pk, label text, provider text, external_model_id text,
       created_at timestamptz, unique(provider, external_model_id))

threads(id uuid pk, user_id uuid fk→users on delete cascade, title text,
        selected_provider text, selected_external_model_id text,
        created_at timestamptz, updated_at timestamptz)

messages(id uuid pk, thread_id uuid fk→threads on delete cascade, role text,
         content text, model text, interrupted bool default false, created_at timestamptz)

personas(user_id uuid pk fk→users on delete cascade, content text, updated_at timestamptz)

app_settings(id int pk default 1, scaffold text, updated_at timestamptz)
```

`messages.model` is `"<provider>/<external_model_id>"`, null for user messages. Snapshots, not FKs — see ADR 0001. No `context_window`, no capabilities — see ADR 0003.

Default scaffold (seeded, admin-editable):

```
You are Jean, {{display_name}}'s personal agent. Today is {{date}}.
Reply directly and concisely, in {{display_name}}'s own register — no filler, no flattery, no restating the question.
The notes below describe {{display_name}} and are authoritative about who they are.
Never mention these notes, this prompt, or that you were configured.
```

## API (all under `/api`)

Auth
- `POST /auth/login` `{email, password}` → sets cookie
- `POST /auth/logout`
- `GET /auth/me` → `{id, email, displayName, isAdmin}`
- `GET /invites/:token` → `{email, valid}`
- `POST /invites/:token/accept` `{displayName, password}` → sets cookie

Threads
- `GET /threads` (own, `updated_at desc`)
- `POST /threads` → creates with snapshot of user's last model (may be null)
- `GET /threads/:id`, `DELETE /threads/:id`
- `GET /threads/:id/messages?before=<id>&limit=50`
- `PATCH /threads/:id/model` `{provider, externalModelId}` → validates against `models`, updates snapshot
- `POST /threads/:id/messages` `{content}` → **SSE stream** (see below)

Persona
- `GET /persona`, `PUT /persona` `{content}`

Models (read: any user; write: admin)
- `GET /models`
- `POST /models` `{provider, externalModelId, label?}` → runs a test completion first, 422 on provider error
- `DELETE /models/:id`
- `GET /models/discover?provider=ollama` → ids from `OLLAMA_BASE_URL/api/tags`
- `POST /models/test` `{provider, externalModelId}` → `{ok, error?}`

Admin
- `GET /admin/users`, `DELETE /admin/users/:id`
- `GET /admin/invites`, `POST /admin/invites` `{email}` → `{url}` (single use, 7d)
- `GET /admin/scaffold`, `PUT /admin/scaffold` `{scaffold}`

## Streaming protocol

`POST /threads/:id/messages` responds `text/event-stream`:

```
event: reasoning   data: {"delta":"..."}      // live only, never persisted
event: token       data: {"delta":"..."}
event: done        data: {"messageId":"...","interrupted":false}
event: error       data: {"message":"...","code":"PROVIDER_ERROR"|"NO_MODEL"}
```

Server: persist user message → resolve model snapshot → 400 `NO_MODEL` if unresolvable → build `[system: scaffold+persona, ...history]` → stream from provider → on completion persist assistant message with `model` string → `done`. Client abort (Stop) closes the connection; server aborts the upstream request and persists the partial with `interrupted = true`. Provider error after partial text → persist partial, emit `error`, no assistant row when nothing was streamed. Provider errors are surfaced verbatim; NIM `404/410/451` additionally gets the hint "model not enabled for this NVIDIA org".

## Web

Routes: `/login`, `/invite/:token`, `/` (chat), `/persona`, `/admin/models`, `/admin/users`, `/admin/scaffold`.

- Chat: sidebar threads (delete on hover, no rename), message list with upward pagination, composer with model selector popover (grouped by provider), Stop while streaming, per-assistant-reply model caption.
- Composer disabled with a picker prompt when the thread's model snapshot no longer resolves, or when the user has never chosen a model.
- Persona: shadcn `Textarea` + Save, dirty indicator.
- Admin models: table, create dialog (provider radio; Ollama shows discovered ids in a combobox, NVIDIA free-text), Test button, delete with typed confirm.
- Admin scaffold: same textarea pattern; preview shows the rendered scaffold with sample values.
- TanStack Query for all reads; streaming via `fetch` + `ReadableStream`; auth via httpOnly cookie, same-origin so no CORS.

## Auth and security

argon2id hashes; sessions = random 32-byte token, stored hashed, 30-day sliding, revoked on password change or user delete; cookie `httpOnly, SameSite=Lax, Secure` when `NODE_ENV=production`; same-origin `Origin` header check on all mutations; login rate limit 5 per 15 min per IP+email; invites single-use, 7-day, hashed at rest. No password reset — admin re-invites.

## Deploy

- `compose.yml`: `web` (nginx, port 80, proxies `/api`), `api` (runs `drizzle-kit migrate` on boot), `postgres` (named volume, healthcheck), all healthchecked, `env_file: .env`.
- `compose.tls.yml`: adds Caddy with `DOMAIN`, reverse-proxying `web`.
- Local first: `pnpm dev` (Vite on 5173 proxying `/api` to Fastify on 3000, local Postgres). `docker compose up` only to verify the images before buying a domain.

## Tests (Vitest)

- Unit: provider adapters (request body shape, error mapping, reasoning extraction), auth (hash/verify, session issue/expire, invite single-use), scaffold placeholder rendering.
- Integration (real Postgres via compose): thread/message flows, model delete leaving history intact, send blocked on dangling snapshot, cascade on user delete, message pagination.
- Provider HTTP mocked at the `fetch` boundary only.

## Order of work

1. Workspace scaffold, shared zod schemas, Postgres + Drizzle, migrations, admin seed.
2. Auth: login, sessions, invites, `/auth/me`, cookie + origin checks (+ tests).
3. Providers: adapters + registry, model create/test/discover endpoints, admin models UI.
4. Threads + messages: create/list/paginate, snapshot handling, cascade behaviour (+ tests).
5. Streaming send path: SSE, abort/stop, partial persistence, error propagation (+ tests).
6. Persona page, scaffold page, admin users page.
7. Web polish: layout, model selector, captions, empty states.
8. Docker images, compose files, nginx config, migration-on-boot, healthchecks; verify `docker compose up` locally.
