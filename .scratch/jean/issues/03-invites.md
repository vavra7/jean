# 03: Invites

**What to build:** The Admin generates a single-use link for an email address, and the person behind that email follows it, sets a display name and password, and lands logged in — no other way in.

**Blocked by:** 02 (Login and sessions)

**Status:** resolved

- [x] `invites` table added by migration; tokens are stored hashed at rest
- [x] The Admin creates an Invite for an email and receives a URL built from `PUBLIC_ORIGIN`, valid for 7 days
- [x] The admin invites list shows email, expiry and whether it has been used
- [x] Opening a valid Invite shows the invited email with display name and password fields
- [x] Accepting creates the account and a session, and marks the Invite used in one step
- [x] Reusing a used Invite, or one past expiry, shows an invalid state and creates no account
- [x] A concurrent second accept cannot create a second account
- [x] Tests cover single-use enforcement and expiry

## Comments

Implemented in `apps/api/src/invites.ts` (routes: POST/GET /api/invites, GET/POST /api/invites/:token(+ /accept)), `apps/api/src/db/schema.ts` (invites Drizzle table), `packages/shared/src/index.ts` (invite schemas), `apps/api/src/auth.ts` (exported hashToken/publicOrigin/SESSION_TTL_MS), `apps/api/src/index.ts` (route registration), `apps/api/src/invites.test.ts` (10 tests). Web: public /invite/:token accept page + admin /admin/invites create/list in `apps/web/src/App.tsx`. Migration 0002 already defined the invites table. Single-use enforced via `SELECT ... FOR UPDATE` + `UPDATE ... WHERE used_at IS NULL` in one transaction; expiry checked before marking used.
