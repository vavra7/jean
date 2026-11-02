# Own TypeScript agent loop, not a wrapper around OpenCode

Status: accepted

OpenCode exposes everything this product needs — sessions, provider catalog, mid-conversation model switching — but wrapping it would make the product a client of someone else's session model, storage, and lifecycle. Chat history, persona documents, model catalog, and multi-user ownership all live in our own Postgres schema, so the agent loop is a thin, owned layer over an OpenAI-compatible HTTP call. The trade-off is that we implement streaming, abort, and persistence ourselves (a few hundred lines) and lose OpenCode's tooling; we accept that because chat is the whole product and tool calling is deliberately out of scope. Recorded so nobody later proposes replacing the loop with an embedded agent runtime without weighing the ownership cost.
