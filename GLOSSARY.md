# Jean

A personal chat agent that knows its user: a global chat app where each user owns a persona document, and an admin owns the model catalog.

## Language

**Provider**:
A hardcoded model integration (`nvidia`, `ollama`); its credentials come from environment variables, never from user data.
_Avoid_: Connection, integration, vendor, account

**Model**:
An admin-defined row (`label`, `provider`, `external_model_id`) that makes a provider's model selectable in chat. It is a selector, not a historical record.
_Avoid_: Connection, endpoint, preset, config

**Thread**:
A linear conversation owned by one user, holding a snapshot of the model it is currently set to use.
_Avoid_: Conversation, chat, session

**Message**:
One turn's text in a thread, carrying the model string that produced it when it was an assistant reply.
_Avoid_: Turn, entry, bubble

**Persona**:
The single markdown document each user writes about themselves; it is appended to the system prompt on every request.
_Avoid_: Profile, memory, system prompt, instructions

**Scaffold**:
The admin-editable, global text that precedes the persona in the system prompt; it carries the agent's role, the date, and placeholders for the user's name.
_Avoid_: Prompt template, preamble, boilerplate

**Invite**:
A single-use, expiring link an admin generates so that one person can set a password and gain an account.
_Avoid_: Signup, registration, onboarding

**Admin**:
The user who defined the model catalog and can manage models, users, invites, and the scaffold.
_Avoid_: Owner, superuser

## Relationships

- A **Thread** is set to one **Model**, by snapshot: the thread stores the provider and external model id, not a reference.
- A **Message** records the model string that produced it, by snapshot, so deleting a **Model** never alters history.
- The system prompt of every request is **Scaffold** + **Persona** of the requesting user.
- Deleting a **Model**, **User**, or **Thread** is permanent. There is no archiving in any of them.
