# 09: Admin users

**What to build:** The Admin sees everyone with an account and can remove one, taking their Threads, Messages, Persona and sessions with them.

**Blocked by:** 03 (Invites)

**Status:** ready-for-agent

- [ ] `GET /admin/users` lists email, display name, admin flag and creation date; non-Admin returns 403
- [ ] The admin users page shows that list with a typed-confirm delete
- [ ] Deleting a user cascades their Threads, Messages, Persona and sessions, and their next request is unauthenticated
- [ ] The Admin cannot delete their own account
- [ ] A deleted user's Invites remain listed as used, with their creator cleared
