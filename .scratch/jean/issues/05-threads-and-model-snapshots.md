# 05: Threads and model snapshots

**What to build:** A user creates Threads, each carrying its own Model snapshot, switches that Model, pages back through Message history and deletes Threads. Deleting a Model leaves every Thread's history readable.

**Blocked by:** 04 (Model catalog)

**Status:** done

- [x] `threads` and `messages` tables added by migration; only ownership relations are foreign keys, and the Thread's Model is a plain snapshot
- [x] Creating a Thread snapshots the user's last chosen Model, and is allowed to be empty when they have never chosen one
- [x] The sidebar lists the user's own Threads by recency; another user's Thread returns 404, never 403
- [x] Switching a Thread's Model updates its snapshot and the user's last chosen Model, validating the choice against the catalog
- [x] Messages paginate upward 50 at a time with no duplicates and no gaps
- [x] Deleting a Thread removes its Messages; deleting a user cascades their Threads
- [x] The composer is disabled with a picker prompt when the Thread's snapshot no longer resolves or was never set
- [x] Tests cover snapshot resolution, history surviving a Model delete, cascade on user delete, and pagination
