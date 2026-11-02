# 07: Persona

**What to build:** A user writes the Persona document describing themselves, and the next reply is shaped by it.

**Blocked by:** 06 (Streaming send)

**Status:** ready-for-agent

- [ ] `personas` table added by migration, one row per user, cascading on user delete
- [ ] `GET /persona` and `PUT /persona` are scoped to the caller; no user can read another's Persona
- [ ] The persona page is a textarea with Save and a dirty indicator, and warns before discarding unsaved edits
- [ ] Persona content is appended after the Scaffold in the system prompt; an empty Persona adds nothing
- [ ] Editing the Persona changes the next request's system prompt and never appears in the visible transcript
