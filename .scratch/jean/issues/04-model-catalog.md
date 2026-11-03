# 04: Model catalog

**What to build:** The Admin curates the catalog of selectable Models across Providers, each one proven to work before it is saved; every user can read the list.

**Blocked by:** 02 (Login and sessions)

**Status:** resolved

- [x] `models` table added by migration with a unique `(provider, external_model_id)`; duplicates are rejected
- [x] Provider adapters for nvidia and ollama sit behind one registry interface; adding a Provider stays a code change
- [x] Creating a Model runs a test completion first: a provider error returns 422 with the provider's message verbatim and persists nothing
- [x] The Ollama create flow offers discovered ids from the local Ollama instance; the NVIDIA flow takes free text
- [x] Test reports ok or the provider error without persisting anything
- [x] Any authenticated user reads the list; a non-Admin write returns 403
- [x] Delete removes the row outright — history is not touched
- [x] Tests cover adapter request body shape, error mapping and reasoning extraction, with provider HTTP mocked at the `fetch` boundary only

## Answer

Issue 04 was already largely implemented (migration 0002 `models` table with `UNIQUE (provider, external_model_id)`, `nvidia`/`ollama` adapters behind `ProviderRegistry`, create/test/discover/delete routes, provider unit tests mocking `fetch`). The one gap was `GET /api/models` requiring admin via `requireAdminHandler` while the spec says any authenticated user reads the list.

Changes:
- `apps/api/src/routes/models.ts`: `GET /api/models` now uses `requireAuthHandler` so any authenticated user can read the catalog; `POST`/`DELETE` keep `requireAdminHandler` (non-admin write → 403).
- `apps/api/src/routes/models.test.ts`: made the mocked session user configurable (admin default), added coverage that a non-admin can GET the list (200) and that non-admin POST/DELETE return 403, plus `GET /api/models/discover` tests (ollama ids returned, nvidia/no-provider → empty list with no fetch call).

Verification: `pnpm typecheck` clean; full vitest suite 66/66 passing including provider tests (request body shape, error mapping, reasoning extraction) and models route tests.
