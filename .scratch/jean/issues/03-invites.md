# 03: Invites

**What to build:** The Admin generates a single-use link for an email address, and the person behind that email follows it, sets a display name and password, and lands logged in — no other way in.

**Blocked by:** 02 (Login and sessions)

**Status:** ready-for-agent

- [ ] `invites` table added by migration; tokens are stored hashed at rest
- [ ] The Admin creates an Invite for an email and receives a URL built from `PUBLIC_ORIGIN`, valid for 7 days
- [ ] The admin invites list shows email, expiry and whether it has been used
- [ ] Opening a valid Invite shows the invited email with display name and password fields
- [ ] Accepting creates the account and a session, and marks the Invite used in one step
- [ ] Reusing a used Invite, or one past expiry, shows an invalid state and creates no account
- [ ] A concurrent second accept cannot create a second account
- [ ] Tests cover single-use enforcement and expiry
