# 09: Admin users

**What to build:** The Admin sees everyone with an account and can remove one, taking their Threads, Messages, Persona and sessions with them.

**Blocked by:** 03 (Invites)

**Status:** resolved

## Answer
Implemented `GET /api/admin/users` (lists email, displayName, isAdmin, createdAt; non-admin 403) and `DELETE /api/admin/users/:id` (cascades threads/messages/persona/sessions via ON DELETE CASCADE, marks the deleted user's invites used with creator cleared, blocks self-delete with 403). Added `AdminUsersView` with a typed-confirm delete (type the email). Verified with unit + integration tests; typecheck and full suite (107 tests) pass.

- [ ] `GET /admin/users` lists email, display name, admin flag and creation date; non-Admin returns 403
- [ ] The admin users page shows that list with a typed-confirm delete
- [ ] Deleting a user cascades their Threads, Messages, Persona and sessions, and their next request is unauthenticated
- [ ] The Admin cannot delete their own account
- [ ] A deleted user's Invites remain listed as used, with their creator cleared
