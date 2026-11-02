# 08: Scaffold

**What to build:** The Admin edits the global Scaffold that precedes every Persona in the system prompt, with a live preview of the rendered result.

**Blocked by:** 06 (Streaming send)

**Status:** ready-for-agent

- [ ] `app_settings` table added by migration and seeded with the default Scaffold from `docs/PLAN.md` when empty
- [ ] Placeholder rendering replaces the display name and today's date; an unknown placeholder is left intact rather than blanked
- [ ] `GET /admin/scaffold` and `PUT /admin/scaffold` are Admin-only; a non-Admin call returns 403
- [ ] The admin page is a textarea with Save and a dirty indicator, and previews the rendered Scaffold against sample values
- [ ] An edit takes effect on the next request, ahead of the Persona in the system prompt
- [ ] Tests cover placeholder rendering, including the unknown-placeholder case
