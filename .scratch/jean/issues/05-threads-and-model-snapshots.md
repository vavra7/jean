# 05: Threads and model snapshots

**What to build:** A user creates Threads, each carrying its own Model snapshot, switches that Model, pages back through Message history and deletes Threads. Deleting a Model leaves every Thread's history readable.

**Blocked by:** 04 (Model catalog)

**Status:** ready-for-agent

- [ ] `threads` and `messages` tables added by migration; only ownership relations are foreign keys, and the Thread's Model is a plain snapshot
- [ ] Creating a Thread snapshots the user's last chosen Model, and is allowed to be empty when they have never chosen one
- [ ] The sidebar lists the user's own Threads by recency; another user's Thread returns 404, never 403
- [ ] Switching a Thread's Model updates its snapshot and the user's last chosen Model, validating the choice against the catalog
- [ ] Messages paginate upward 50 at a time with no duplicates and no gaps
- [ ] Deleting a Thread removes its Messages; deleting a user cascades their Threads
- [ ] The composer is disabled with a picker prompt when the Thread's snapshot no longer resolves or was never set
- [ ] Tests cover snapshot resolution, history surviving a Model delete, cascade on user delete, and pagination
