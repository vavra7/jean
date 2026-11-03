# 08: Scaffold

**What to build:** The Admin edits the global Scaffold that precedes every Persona in the system prompt, with a live preview of the rendered result.

**Blocked by:** 06 (Streaming send)

**Status:** resolved

- [x] `app_settings` table added by migration and seeded with the default Scaffold from `docs/PLAN.md` when empty
- [x] Placeholder rendering replaces the display name and today's date; an unknown placeholder is left intact rather than blanked
- [x] `GET /admin/scaffold` and `PUT /admin/scaffold` are Admin-only; a non-Admin call returns 403
- [x] The admin page is a textarea with Save and a dirty indicator, and previews the rendered Scaffold against sample values
- [x] An edit takes effect on the next request, ahead of the Persona in the system prompt
- [x] Tests cover placeholder rendering, including the unknown-placeholder case

## Comments

Done. Data layer pre-existed (migration 0004 `app_settings`, `seedDefaultScaffold()`, per-request `buildSystemPrompt` read ahead of Persona); this diff adds:
- `packages/shared/src/index.ts`: `ScaffoldSchema`
- `apps/api/src/routes/scaffold.ts`: GET/PUT `/api/admin/scaffold`, `requireAdminHandler` (403 non-admin / 401 unauthenticated)
- `apps/api/src/index.ts`: route registration
- `apps/api/src/routes/scaffold.test.ts`: 7 tests (get/put/401/403 on both methods)
- `apps/api/src/system-prompt.test.ts`: 5 placeholder-rendering tests incl. unknown placeholder left intact
- `apps/web/src/App.tsx`: `/admin/scaffold` route, `AdminScaffoldView` (textarea, Save, dirty indicator, live preview vs sample values), admin Scaffold button in chat header

Verification: `pnpm typecheck` clean; full vitest suite 99/99 passing; code-review skill (Standards + Spec axes): 0 hard violations, 0 spec gaps.

## Comments

Done. Data layer pre-existed (migration 0004 `app_settings`, `seedDefaultScaffold()`, per-request `buildSystemPrompt` read ahead of Persona); this diff adds:
- `packages/shared/src/index.ts`: `ScaffoldSchema`
- `apps/api/src/routes/scaffold.ts`: GET/PUT `/api/admin/scaffold`, `requireAdminHandler` (403 non-admin / 401 unauthenticated)
- `apps/api/src/src/index.ts`: route registration
- `apps/api/src/routes/scaffold.test.ts`: 7 tests (get/put/401/403 on both methods)
- `apps/api/src/system-prompt.test.ts`: 5 placeholder-rendering tests incl. unknown placeholder left intact
- `apps/web/src/App.tsx`: `/admin/scaffold` route, `AdminScaffoldView` (textarea, Save, dirty indicator, live preview vs sample values), admin Scaffold button in chat header

Verification: `pnpm typecheck` clean; full vitest suite 99/99 passing; code-review skill (Standards + Spec axes): 0 hard violations, 0 spec gaps.
