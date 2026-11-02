# 02: Login and sessions

**What to build:** A user signs in with email and password and stays signed in across reloads; the SPA knows who they are and anonymous visitors are sent to the login page.

**Blocked by:** 01 (Walking skeleton)

**Status:** ready-for-agent

- [ ] `sessions` table added by migration; session tokens are random, stored hashed, and expire after 30 days of inactivity
- [ ] Login with the seeded Admin credentials sets an httpOnly `SameSite=Lax` cookie and `GET /auth/me` returns id, email, display name and admin flag
- [ ] Wrong password and unknown email both return an identical 401, revealing nothing about which accounts exist
- [ ] More than 5 attempts per 15 minutes per IP+email returns 429
- [ ] A mutation carrying a foreign `Origin` header is rejected
- [ ] Logout clears the cookie and invalidates the session; an expired session is treated as logged out
- [ ] `/login` redirects to the chat on success; visiting `/` while anonymous redirects to `/login`
- [ ] Tests cover hashing/verification, session issue and expiry, and the origin check
