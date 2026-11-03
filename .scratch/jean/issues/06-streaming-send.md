# 06: Streaming send

**What to build:** Sending a Message streams the reply live, persists it against the Model that produced it, and survives a mid-stream Stop or a provider failure without losing what was already shown.

**Blocked by:** 04 (Model catalog), 05 (Threads and model snapshots)

**Status:** done

- [x] `POST /threads/:id/messages` responds as an event stream: reasoning deltas, token deltas, done, error (see `docs/PLAN.md` streaming protocol)
- [x] The user Message is persisted first, then the assistant Message is persisted with `"<provider>/<external_model_id>"` on completion
- [x] Reasoning deltas reach the client live and are never persisted
- [x] Stop aborts the upstream request, persists the partial reply with `interrupted = true`, and the partial survives a reload
- [x] A provider error before any token emits `error` and leaves no assistant Message; after partial text the partial is persisted and the error still emitted
- [x] An unresolvable Model snapshot returns `NO_MODEL` and persists nothing
- [x] Provider errors are surfaced verbatim, with the NVIDIA org hint added on 404/410/451
- [x] The system prompt is the Scaffold followed by the Persona
- [x] Each assistant reply shows the Model that produced it; the composer is locked while streaming
- [x] Tests cover the event sequence, abort and partial persistence, and error propagation, with provider HTTP mocked at the `fetch` boundary only
