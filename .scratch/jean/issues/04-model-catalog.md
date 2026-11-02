# 04: Model catalog

**What to build:** The Admin curates the catalog of selectable Models across Providers, each one proven to work before it is saved; every user can read the list.

**Blocked by:** 02 (Login and sessions)

**Status:** ready-for-agent

- [ ] `models` table added by migration with a unique `(provider, external_model_id)`; duplicates are rejected
- [ ] Provider adapters for nvidia and ollama sit behind one registry interface; adding a Provider stays a code change
- [ ] Creating a Model runs a test completion first: a provider error returns 422 with the provider's message verbatim and persists nothing
- [ ] The Ollama create flow offers discovered ids from the local Ollama instance; the NVIDIA flow takes free text
- [ ] Test reports ok or the provider error without persisting anything
- [ ] Any authenticated user reads the list; a non-Admin write returns 403
- [ ] Delete removes the row outright — history is not touched
- [ ] Tests cover adapter request body shape, error mapping and reasoning extraction, with provider HTTP mocked at the `fetch` boundary only
