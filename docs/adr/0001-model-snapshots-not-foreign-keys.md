# Model snapshots instead of content foreign keys

Status: accepted

Threads and messages store the provider and external model id as plain text snapshots rather than referencing `models.id`. Models are admin-editable and hard-deleted, so a foreign key would either orphan history or force a soft-delete/archiving scheme that this product explicitly rejects. With snapshots, `DELETE FROM models` is the whole delete operation: history keeps rendering its old model strings, and a thread whose model no longer exists simply blocks sending until the user picks another one. The cost is duplicated strings and stale settings — a thread keeps the model configuration it had when the model was chosen, which is the desired behaviour anyway.

Only ownership relations (`threads.user_id`, `messages.thread_id`, `personas.user_id`, `sessions.user_id`) are foreign keys.
