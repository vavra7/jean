# 02: Login and sessions

**What to build:** A user signs in with email and password and stays signed in across reloads; the SPA knows who they are and anonymous visitors are sent to the login page.

**Blocked by:** 01 (Walking skeleton)

**Status:** resolved

- [x] `sessions` table added by migration; session tokens are random, stored hashed, and expire after 30 days of inactivity
- [x] Login with the seeded Admin credentials sets an httpOnly `SameSite=Lax` cookie and `GET /auth/me` returns id, email, display name and admin flag
- [x] Wrong password and unknown email both return an identical 401, revealing nothing about which accounts exist
- [x] More than 5 attempts per 15 minutes per IP+email returns 429
- [x] A mutation carrying a foreign `Origin` header is rejected
- [x] Logout clears the cookie and invalidates the session; an expired session is treated as logged out
- [x] `/login` redirects to the chat on success; visiting `/` while anonymous redirects to `/login`
- [x] Tests cover hashing/verification, session issue and expiry, and the origin check

## Comments

Implemented in commit 0284ed4 ("Issue 02: login and sessions"). Backend: sessions Drizzle table with hashed tokens + sliding 30-day TTL, login/logout/auth-me routes, origin check, 5/15min rate limit per IP+email. Web: /login page, / → /login redirect when anonymous, /login → /chat on success. Tests: apps/api/src/auth.test.ts (14 tests) covering real argon2 verification vs seeded Admin credentials, session issue/expiry, origin check.
