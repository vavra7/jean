# 07: Persona

**What to build:** A user writes the Persona document describing themselves, and the next reply is shaped by it.

**Blocked by:** 06 (Streaming send)

**Status:** resolved

## Answer
- `personas` table: migration `0004_app_settings_personas.sql` (applied to DB); `user_id PK → users(id) ON DELETE CASCADE`. Verified by integration test (row deletes with its user).
- `GET /api/persona`, `PUT /api/persona` in `apps/api/src/routes/persona.ts`, scoped to the caller via `WHERE user_id = $1` / upsert on `user_id`; 401 without session; 400 on missing content. Unit + real-DB integration tests (cross-user isolation, empty content default).
- Persona page at `/persona` in `apps/web/src/App.tsx`: textarea, Save, "unsaved changes" dirty indicator, `beforeunload` warning, in-app navigation confirm when dirty; linked from the chat header ("Persona") for all users.
- System prompt: `buildSystemPrompt` appends rendered Scaffold + user Persona (`\n\n` separator, empty adds nothing) — already in `system-prompt.ts`, built per request from DB, so an edit shapes the next request; persona is never written to `messages`, so it never appears in the transcript.
- `vitest.config.ts`: `maxWorkers: 1` because the two DB integration files share one Postgres and clean tables globally.
- Also fixed a pre-existing flake in `threads.integration.test.ts` (same-timestamp messages ordered by random UUID id).

Tests: 87 passing, 5 consecutive clean runs; typecheck clean.
