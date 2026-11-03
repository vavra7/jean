import { useCallback, useEffect, useRef, useState } from "react";
import {
  AcceptInviteSchema,
  AuthMeSchema,
  InviteListSchema,
  ModelListSchema,
  MessageListSchema,
  PersonaSchema,
  ScaffoldSchema,
  ThreadListSchema,
  UserListSchema,
} from "@jean/shared";
import type {
  AuthMe,
  Invite,
  Message,
  Model,
  Persona,
  Scaffold,
  Thread,
  User,
} from "@jean/shared";

type Route =
  | "/login"
  | "/chat"
  | "/invite"
  | "/admin/invites"
  | "/admin/scaffold"
  | "/admin/users"
  | "/persona";

function routeOf(pathname: string): Route {
  if (pathname === "/login") return "/login";
  if (pathname === "/chat") return "/chat";
  if (pathname === "/admin/invites") return "/admin/invites";
  if (pathname === "/admin/scaffold") return "/admin/scaffold";
  if (pathname === "/admin/users") return "/admin/users";
  if (pathname === "/persona") return "/persona";
  if (pathname.startsWith("/invite/")) return "/invite";
  return "/login";
}

function inviteToken(pathname: string): string | null {
  const match = pathname.match(/^\/invite\/([^/]+)$/);
  return match ? match[1] : null;
}

async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  const text = await res.text();
  return text.length ? JSON.parse(text) : null;
}

function App() {
  const [user, setUser] = useState<AuthMe | null>(null);
  const [route, setRoute] = useState<Route>("/login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [personaDirty, setPersonaDirty] = useState(false);
  const [scaffoldDirty, setScaffoldDirty] = useState(false);

  const navigate = useCallback(
    (to: string) => {
      const dirty = personaDirty || scaffoldDirty;
      if (dirty && to !== "/persona" && to !== "/admin/scaffold") {
        if (!window.confirm("You have unsaved changes. Leave anyway?")) return;
      }
      window.history.pushState({}, "", to);
      setRoute(routeOf(to));
    },
    [personaDirty, scaffoldDirty],
  );

  useEffect(() => {
    let mounted = true;
    const onPopState = () => {
      if (!mounted) return;
      setRoute(routeOf(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);

    const token = inviteToken(window.location.pathname);
    const isInvitePage = token !== null;

    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        return AuthMeSchema.parse(await res.json());
      })
      .then((me) => {
        if (!mounted) return;
        setUser(me ?? null);
        setLoading(false);
        const current = routeOf(window.location.pathname);
        if (me) {
          if (current === "/login") {
            navigate("/chat");
          } else if (current === "/admin/invites" && !me.isAdmin) {
            navigate("/chat");
          } else if (current === "/admin/scaffold" && !me.isAdmin) {
            navigate("/chat");
          } else if (current === "/admin/users" && !me.isAdmin) {
            navigate("/chat");
          }
          return;
        }
        if (!isInvitePage && current !== "/login") {
          navigate("/login");
        }
      })
      .catch(() => {
        if (!mounted) return;
        setLoading(false);
        setUser(null);
        if (!isInvitePage) {
          navigate("/login");
        }
      });
    return () => {
      mounted = false;
      window.removeEventListener("popstate", onPopState);
    };
  }, [navigate]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
        const res = await fetch("/api/auth/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          setError("Invalid email or password.");
          return;
        }
        const me = AuthMeSchema.parse(await res.json());
        setUser(me);
        navigate("/chat");
    },
    [navigate],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    // Sign out is terminal: the caller (ChatView) already confirms discards
    // when the Persona is dirty, so navigate's dirty guard is skipped here.
    window.history.pushState({}, "", "/login");
    setRoute("/login");
  }, []);

  if (loading) {
    return <div data-testid="auth-loading">loading…</div>;
  }

  const token = inviteToken(window.location.pathname);
  if (token && route === "/invite") {
    return (
      <InviteView
        token={token}
        user={user}
        setUser={setUser}
        onAuthenticated={() => navigate("/chat")}
      />
    );
  }

  if (!user) {
    if (route === "/login") {
      return <LoginView onLogin={login} error={error} />;
    }
    navigate("/login");
    return <div data-testid="auth-redirect">redirecting to /login…</div>;
  }
  if (route === "/login") {
    navigate("/chat");
    return <div data-testid="auth-redirect">redirecting to /chat…</div>;
  }
  if (route === "/admin/invites") {
    if (!user.isAdmin) {
      navigate("/chat");
      return <div data-testid="auth-redirect">redirecting to /chat…</div>;
    }
    return <AdminInvitesView onLogout={logout} />;
  }
  if (route === "/persona") {
    return (
      <PersonaView
        user={user}
        personaDirty={personaDirty}
        setPersonaDirty={setPersonaDirty}
        navigate={navigate}
      />
    );
  }
  if (route === "/admin/scaffold") {
    if (!user.isAdmin) {
      navigate("/chat");
      return <div data-testid="auth-redirect">redirecting to /chat…</div>;
    }
    return (
      <AdminScaffoldView
        user={user}
        scaffoldDirty={scaffoldDirty}
        setScaffoldDirty={setScaffoldDirty}
        navigate={navigate}
      />
    );
  }
  if (route === "/admin/users") {
    if (!user.isAdmin) {
      navigate("/chat");
      return <div data-testid="auth-redirect">redirecting to /chat…</div>;
    }
    return <AdminUsersView onLogout={logout} currentUserId={user.id} />;
  }
  return (
    <ChatView
      user={user}
      personaDirty={personaDirty}
      scaffoldDirty={scaffoldDirty}
      onLogout={logout}
      onManageInvites={() => navigate("/admin/invites")}
      onManageUsers={() => navigate("/admin/users")}
      onScaffold={() => navigate("/admin/scaffold")}
      onPersona={() => navigate("/persona")}
    />
  );
}

function LoginView({
  onLogin,
  error,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        await onLogin(email, password);
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, onLogin],
  );

  return (
    <div data-testid="login-page" className="page">
      <h1 data-testid="login-heading">Sign in</h1>
      {error && <div data-testid="login-error">{error}</div>}
      <form data-testid="login-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>Email</label>
          <input
            data-testid="login-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            data-testid="login-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button data-testid="login-submit" type="submit" disabled={submitting} className="btn primary">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function InviteView({
  token,
  user,
  setUser,
  onAuthenticated,
}: {
  token: string;
  user: AuthMe | null;
  setUser: (u: AuthMe | null) => void;
  onAuthenticated: () => void;
}) {
  const [step, setStep] = useState<"validating" | "form" | "invalid" | "success">("validating");
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/invites/${token}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        if (data?.email) {
          setEmail(data.email);
          setStep("form");
        } else {
          setStep("invalid");
        }
      })
      .catch(() => {
        if (!mounted) return;
        setStep("invalid");
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch(`/api/invites/${token}/accept`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(AcceptInviteSchema.parse({ displayName, password })),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "This invite is no longer valid.");
          if (res.status === 401) setStep("invalid");
          return;
        }
        const me = AuthMeSchema.parse(await res.json());
        setUser(me);
        setStep("success");
        onAuthenticated();
      } finally {
        setSubmitting(false);
      }
    },
    [token, displayName, password, user, setUser, onAuthenticated],
  );

  if (step === "validating") {
    return <div data-testid="invite-loading">Validating invite…</div>;
  }
  if (step === "invalid") {
    return (
      <div className="page">
        <h1 data-testid="invite-heading">Invite not valid</h1>
        <p>This invite link is invalid, has already been used, or has expired.</p>
      </div>
    );
  }
  if (step === "success") {
    return (
      <div className="page">
        <h1 data-testid="invite-heading">Account created</h1>
        <p>You are signed in. Redirecting to chat…</p>
      </div>
    );
  }
  return (
    <div className="page" data-testid="invite-page">
      <h1 data-testid="invite-heading">Set up your account</h1>
      <p>Create a password for {email}</p>
      <form data-testid="invite-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>Display name</label>
          <input
            data-testid="invite-display-name"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            data-testid="invite-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div data-testid="invite-error">{error}</div>}
        <button
          data-testid="invite-submit"
          type="submit"
          disabled={submitting}
          className="btn primary"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}

function chatTime(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function modelLabel(thread: Thread | null, models: Model[]): string {
  if (!thread?.selectedProvider || !thread.selectedExternalModelId) {
    return "No model";
  }
  const found = models.find(
    (m) => m.provider === thread.selectedProvider && m.externalModelId === thread.selectedExternalModelId,
  );
  return found ? `${found.label || thread.selectedExternalModelId}` : `${thread.selectedProvider}/${thread.selectedExternalModelId} (deleted)`;
}

function snapshotResolves(thread: Thread | null, models: Model[]): boolean {
  if (!thread?.selectedProvider || !thread.selectedExternalModelId) {
    return false;
  }
  return models.some(
    (m) => m.provider === thread.selectedProvider && m.externalModelId === thread.selectedExternalModelId,
  );
}

function ChatView({
  user,
  personaDirty,
  scaffoldDirty,
  onLogout,
  onManageInvites,
  onManageUsers,
  onScaffold,
  onPersona,
}: {
  user: AuthMe;
  personaDirty: boolean;
  scaffoldDirty: boolean;
  onLogout: () => void;
  onManageInvites: () => void;
  onManageUsers: () => void;
  onScaffold: () => void;
  onPersona: () => void;
}) {
  const handleLogout = useCallback(async () => {
    const dirty = personaDirty || scaffoldDirty;
    if (dirty && !window.confirm("You have unsaved changes. Sign out anyway?")) return;
    await onLogout();
  }, [personaDirty, scaffoldDirty, onLogout]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerContent, setComposerContent] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastBefore, setLastBefore] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentThread = threads.find((t) => t.id === currentThreadId) ?? null;
  const canCompose = currentThread ? snapshotResolves(currentThread, models) : false;

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    setError(null);
    try {
      const data = ThreadListSchema.parse(await apiJson("/api/threads"));
      setThreads(data);
      if (!currentThreadId && data.length > 0) {
        setCurrentThreadId(data[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load threads.");
    } finally {
      setLoadingThreads(false);
    }
  }, [currentThreadId]);

  const loadModels = useCallback(async () => {
    try {
      setModels(ModelListSchema.parse(await apiJson("/api/models")));
    } catch {
      // Catalog is optional for the chat shell; composer will show "no model" if empty.
      setModels([]);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    loadModels();
  }, [loadThreads, loadModels]);

  useEffect(() => {
    if (currentThreadId) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [currentThreadId, messages]);

  const loadMessages = useCallback(
    async (before: string | null, append: boolean) => {
      if (!currentThreadId) return;
      setLoadingMessages(true);
      try {
        const url = new URL(`/api/threads/${currentThreadId}/messages`, window.location.origin);
        url.searchParams.set("limit", "50");
        if (before) url.searchParams.set("before", before);
        const data = MessageListSchema.parse(await apiJson(url.toString()));
        const ordered = [...data].reverse(); // oldest first for display
        setMessages((prev) => (append ? [...prev, ...ordered] : ordered));
        setLastBefore(data.length > 0 ? data[data.length - 1].id : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load messages.");
      } finally {
        setLoadingMessages(false);
      }
    },
    [currentThreadId],
  );

  useEffect(() => {
    if (currentThreadId) {
      loadMessages(null, false);
    } else {
      setMessages([]);
      setLastBefore(null);
    }
  }, [currentThreadId, loadMessages]);

  const handleCreateThread = useCallback(async () => {
    setError(null);
    try {
      const created = await apiJson("/api/threads", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const thread = ThreadListSchema.parse([created])[0];
      setThreads((prev) => [thread, ...prev]);
      setCurrentThreadId(thread.id);
      setMessages([]);
      setLastBefore(null);
      setComposerContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create thread.");
    }
  }, []);

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      if (!confirm("Delete this thread?")) return;
      setError(null);
      try {
        await apiJson(`/api/threads/${threadId}`, { method: "DELETE" });
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        if (currentThreadId === threadId) {
          setCurrentThreadId(threads.length > 1 ? threads.find((t) => t.id !== threadId)!.id : null);
          setMessages([]);
          setLastBefore(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete thread.");
      }
    },
    [currentThreadId, threads],
  );

  const handleSwitchModel = useCallback(
    async (provider: string, externalModelId: string) => {
      if (!currentThreadId) return;
      setError(null);
      setPickerOpen(false);
      try {
        const updated = await apiJson(`/api/threads/${currentThreadId}/model`, {
          method: "PATCH",
          body: JSON.stringify({ provider, externalModelId }),
        });
        const thread = ThreadListSchema.parse([updated])[0];
        setThreads((prev) => prev.map((t) => (t.id === thread.id ? thread : t)));
        setMessages([]);
        setLastBefore(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to switch model.");
      }
    },
    [currentThreadId, threads],
  );

  // SSE streaming send.
  const handleSend = useCallback(async (e?: React.MouseEvent | React.FormEvent) => {
    e?.preventDefault();
    if (!currentThreadId || !canCompose || !composerContent.trim()) return;
    const content = composerContent.trim();
    setComposerContent("");
    setSending(true);
    setError(null);
    abortControllerRef.current = new AbortController();
    try {
      const res = await fetch(`/api/threads/${currentThreadId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `send failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let partial = "";
      let assistantId: string | null = null;
      let interrupted = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let eventName = "";
          let dataStr = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          const data = JSON.parse(dataStr);
          if (eventName === "token") {
            partial += data.delta;
          } else if (eventName === "done") {
            assistantId = data.messageId ?? null;
            interrupted = !!data.interrupted;
          } else if (eventName === "error") {
            throw new Error(data.message ?? "stream error");
          }
        }
      }
      setMessages((prev) => [
        ...prev,
        { role: "user", content, model: null, interrupted: false, createdAt: new Date().toISOString(), id: "0" },
        {
          role: "assistant",
          content: partial,
          model: currentThread?.selectedProvider && currentThread?.selectedExternalModelId
            ? `${currentThread.selectedProvider}/${currentThread.selectedExternalModelId}`
            : null,
          interrupted,
          createdAt: new Date().toISOString(),
          id: assistantId ?? "0",
        },
      ]);
      setLastBefore(null);
      loadMessages(null, false);
    } catch (err) {
      // A client-initiated Stop: the server already persisted the partial with
      // interrupted = true. Reload so the partial survives without surfacing an error.
      if (err instanceof DOMException && err.name === "AbortError") {
        await loadMessages(null, false);
      } else {
        setError(err instanceof Error ? err.message : "Failed to send message.");
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  }, [currentThreadId, canCompose, composerContent, currentThread, loadMessages]);

  const handleLoadMore = useCallback(() => {
    if (!currentThreadId || loadingMessages) return;
    loadMessages(lastBefore, true);
  }, [currentThreadId, loadingMessages, lastBefore, loadMessages]);

  const noModelReason = currentThread ? (
    !currentThread.selectedProvider && !currentThread.selectedExternalModelId
      ? "You haven't chosen a model for this thread yet."
      : "This thread's model is no longer in the catalog."
  ) : null;

  if (loadingThreads) {
    return (
      <div className="chat-layout">
        <div className="sidebar"><div className="title">Jean</div><div className="list">loading…</div></div>
        <div className="main">loading…</div>
      </div>
    );
  }

  const currentThreadModelResolves = snapshotResolves(currentThread, models);

  return (
    <div className="app-layout">
      <div className="chat-layout">
        <aside className="sidebar">
          <div className="title">Jean</div>
          <div className="list">
            <button
              data-testid="sidebar-new-thread"
              className="new-thread"
              onClick={handleCreateThread}
              disabled={loadingThreads}
            >
              + New thread
            </button>
            {threads.length === 0 && <div style={{ padding: "12px 14px", color: "#6b7280", fontSize: 13 }}>No threads yet.</div>}
            {threads.map((t) => {
              const selected = t.id === currentThreadId;
              return (
                <div
                  key={t.id}
                  data-testid="thread-row"
                  className={`thread-row ${selected ? "selected" : ""}`}
                  onClick={() => setCurrentThreadId(t.id)}
                >
                  <div className="title">{t.title}</div>
                  <div className="meta">{chatTime(t.updatedAt)}</div>
                  <div className="model">{modelLabel(t, models)}</div>
                  <button
                    data-testid="thread-delete"
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteThread(t.id);
                    }}
                  >
                    delete
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <main className="main">
          <div className="thread-header">
            <div className="title">
              {currentThread ? currentThread.title : "Select a thread"}
            </div>
            <div className="actions">
              {user.isAdmin && (
                <>
                  <button data-testid="chat-manage-invites" onClick={onManageInvites} className="icon-btn">
                    Invites
                  </button>
                  <button data-testid="chat-scaffold" onClick={onScaffold} className="icon-btn">
                    Scaffold
                  </button>
                  <button data-testid="chat-manage-users" onClick={onManageUsers} className="icon-btn">
                    Users
                  </button>
                </>
              )}
              <button
                data-testid="chat-persona"
                onClick={onPersona}
                className="icon-btn"
              >
                Persona
              </button>
              <button
                data-testid="chat-logout"
                onClick={handleLogout}
                className="icon-btn"
              >
                Sign out
              </button>
            </div>
          </div>

          {currentThread === null && (
            <div className="empty">
              <h2>No thread selected</h2>
              <p className="muted">Create a new thread or select one from the sidebar.</p>
            </div>
          )}

          {currentThread !== null && (
            <>
              <div className="thread-header" style={{ borderTop: "1px solid #e5e7eb" }}>
                <span className={`model-badge ${currentThreadModelResolves ? "" : "none"}`}>
                  {modelLabel(currentThread, models)}
                </span>
              </div>
              <div className="messages" ref={messagesEndRef}>
                {loadingMessages && messages.length === 0 && <div style={{ color: "#6b7280" }}>loading…</div>}
                {messages.map((m) => (
                  <div key={m.id} data-testid="message" className={`message ${m.role}`}>
                    {m.content}
                    <span className="meta">{m.role === "assistant" && m.model ? m.model : ""} {chatTime(m.createdAt)}</span>
                  </div>
                ))}
                {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</div>}
                {!currentThreadModelResolves && messages.length === 0 && !loadingMessages && (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>No messages yet.</div>
                )}
              </div>
              {messages.length > 0 && !loadingMessages && lastBefore && (
                <button data-testid="load-more" className="btn" onClick={handleLoadMore} style={{ alignSelf: "center", marginBottom: 12 }}>
                  Load more messages
                </button>
              )}
              <div className="composer">
                <div className="composer-row">
                  {!currentThreadModelResolves ? (
                    <div className="prompt">
                      <div className="prompt-title">Choose a model to start chatting</div>
                      <div style={{ color: "#9ca3af", fontSize: 12 }}>{noModelReason}</div>
                      <button
                        data-testid="composer-pick-model"
                        className="choose-btn"
                        onClick={() => setPickerOpen(true)}
                      >
                        Choose model
                      </button>
                    </div>
                  ) : (
                    <>
                      <textarea
                        data-testid="composer"
                        value={composerContent}
                        onChange={(e) => setComposerContent(e.target.value)}
                        placeholder="Write a message…"
                        disabled={sending}
                      />
                      <button
                        data-testid="composer-send"
                        className="send"
                        onClick={handleSend}
                        disabled={sending || !composerContent.trim()}
                      >
                        Send
                      </button>
                    </>
                  )}
                </div>
                {sending && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Streaming…</span>
                  <button
                    data-testid="composer-stop"
                    onClick={() => abortControllerRef.current?.abort()}
                    className="btn"
                  >
                    Stop
                  </button>
                </div>
              )}
              </div>
            </>
          )}

          {pickerOpen && currentThread && (
            <div className="picker" style={{ top: 48, right: 16, position: "absolute" }}>
              {models.length === 0 ? (
                <div style={{ padding: 8, fontSize: 12, color: "#6b7280" }}>No models in catalog.</div>
              ) : (
                <>
                  <div className="picker-group-title">Models</div>
                  {models.map((m) => {
                    const selected =
                      currentThread.selectedProvider === m.provider &&
                      currentThread.selectedExternalModelId === m.externalModelId;
                    return (
                      <button
                        key={m.id}
                        className={`picker-item ${selected ? "selected" : ""}`}
                        onClick={() => handleSwitchModel(m.provider, m.externalModelId)}
                      >
                        {m.label || m.externalModelId} <span style={{ color: "#9ca3af", fontSize: 11 }}>{m.provider}/{m.externalModelId}</span>
                      </button>
                    );
                  })}
                </>
              )}
              <hr className="hr" />
              <button className="picker-item" onClick={() => setPickerOpen(false)}>Close</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AdminInvitesView({ onLogout }: { onLogout: () => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch("/api/invites", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("failed to load invites");
        return InviteListSchema.parse(await res.json());
      })
      .then((data) => {
        if (!mounted) return;
        setInvites(data);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Failed to load invites.");
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleCreate = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setCreating(true);
      try {
        const res = await fetch("/api/invites", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Failed to create invite.");
          return;
        }
        const data = await res.json();
        setInvites((prev) => [
          { ...data, id: data.id, expiresAt: data.expiresAt, usedAt: null, used: false },
          ...prev,
        ]);
        setEmail("");
      } finally {
        setCreating(false);
      }
    },
    [email],
  );

  return (
    <div className="page" data-testid="admin-invites-page">
      <h1 data-testid="admin-invites-heading">Invites</h1>
      <button data-testid="admin-logout" onClick={onLogout} className="btn" style={{ marginBottom: 12 }}>
        Sign out
      </button>
      {error && <div data-testid="admin-invites-error">{error}</div>}
      <form data-testid="admin-invite-create" onSubmit={handleCreate} className="form">
        <div className="field">
          <label>Email</label>
          <input
            data-testid="admin-invite-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <button data-testid="admin-invite-create-submit" type="submit" disabled={creating} className="btn primary">
          {creating ? "Creating…" : "Create invite"}
        </button>
      </form>
      {loading ? (
        <div data-testid="admin-invites-loading">Loading…</div>
      ) : (
        <ul data-testid="admin-invite-list">
          {invites.map((invite) => (
            <li key={invite.id} data-testid="admin-invite-row">
              {invite.email} — expires {new Date(invite.expiresAt).toLocaleString()} —
              {invite.used ? "used" : "unused"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonaView({
  user,
  personaDirty,
  setPersonaDirty,
  navigate,
}: {
  user: AuthMe;
  personaDirty: boolean;
  setPersonaDirty: (dirty: boolean) => void;
  navigate: (to: string) => void;
}) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== saved;

  useEffect(() => {
    let mounted = true;
    apiJson("/api/persona")
      .then((data: Persona | null) => {
        if (!mounted) return;
        const value = data?.content ?? "";
        setContent(value);
        setSaved(value);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load persona.");
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Reset the dirty flag when leaving the page so a confirmed discard
  // doesn't block later navigation.
  useEffect(() => {
    return () => {
      setPersonaDirty(false);
    };
  }, [setPersonaDirty]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setError(null);
      setContent(e.target.value);
    },
    [],
  );

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/persona", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PersonaSchema.parse({ content })),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save persona.");
        return;
      }
      setSaved(content);
      setPersonaDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save persona.");
    } finally {
      setSaving(false);
    }
  }, [content, setPersonaDirty]);

  // Warn before discarding unsaved edits on refresh / tab close.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  const handleBack = useCallback(() => {
    navigate("/chat");
  }, [navigate]);

  return (
    <div className="page" data-testid="persona-page">
      <h1 data-testid="persona-heading">Persona</h1>
      <p>
        Your Persona is appended to the system prompt on every request and
        shapes Jean's replies. It is never shown in the chat transcript.
      </p>
      {error && <div data-testid="persona-error">{error}</div>}
      <form data-testid="persona-form" onSubmit={handleSave} className="form">
        <div className="field">
          <label>Persona</label>
          <textarea
            data-testid="persona-textarea"
            value={content}
            onChange={handleChange}
            rows={16}
            style={{ width: "100%", minHeight: 260 }}
          />
        </div>
        <div className="actions">
          <button data-testid="persona-back" onClick={handleBack} className="btn">
            Back to chat
          </button>
          {dirty && (
            <span data-testid="persona-dirty" className="muted">
              unsaved changes
            </span>
          )}
          <button
            data-testid="persona-save"
            type="submit"
            disabled={!dirty || saving}
            className="btn primary"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AdminScaffoldView({
  user,
  scaffoldDirty,
  setScaffoldDirty,
  navigate,
}: {
  user: AuthMe;
  scaffoldDirty: boolean;
  setScaffoldDirty: (dirty: boolean) => void;
  navigate: (to: string) => void;
}) {
  const [scaffold, setScaffold] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = scaffold !== saved;

  useEffect(() => {
    let mounted = true;
    apiJson("/api/admin/scaffold")
      .then((data: Scaffold | null) => {
        if (!mounted) return;
        const value = data?.scaffold ?? "";
        setScaffold(value);
        setSaved(value);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load scaffold.");
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Reset the dirty flag when leaving the page so a confirmed discard
  // doesn't block later navigation.
  useEffect(() => {
    return () => {
      setScaffoldDirty(false);
    };
  }, [setScaffoldDirty]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setError(null);
      setScaffold(e.target.value);
    },
    [],
  );

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/scaffold", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ScaffoldSchema.parse({ scaffold })),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to save scaffold.");
        return;
      }
      setSaved(scaffold);
      setScaffoldDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scaffold.");
    } finally {
      setSaving(false);
    }
  }, [scaffold, setScaffoldDirty]);

  // Warn before discarding unsaved edits on refresh / tab close.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  const handleBack = useCallback(() => {
    navigate("/chat");
  }, [navigate]);

  // Sample values used for the live preview, mirroring the server's placeholders.
  const today = new Date().toISOString().slice(0, 10);
  const preview = scaffold
    .replace(/\{\{display_name\}\}/g, "Alex")
    .replace(/\{\{date\}\}/g, today);

  return (
    <div className="page" data-testid="admin-scaffold-page">
      <h1 data-testid="admin-scaffold-heading">Scaffold</h1>
      <p>{`The Scaffold precedes every Persona in the system prompt on each request. {{display_name}} and {{date}} are rendered per request; unknown placeholders are left as-is.`}</p>
      {error && <div data-testid="admin-scaffold-error">{error}</div>}
      <form data-testid="admin-scaffold-form" onSubmit={handleSave} className="form">
        <div className="field">
          <label>Scaffold</label>
          <textarea
            data-testid="admin-scaffold-textarea"
            value={scaffold}
            onChange={handleChange}
            rows={16}
            style={{ width: "100%", minHeight: 260 }}
          />
        </div>
        <div className="field preview">
          <label>Preview (as Alex, {today})</label>
          <pre data-testid="admin-scaffold-preview">{preview}</pre>
        </div>
        <div className="actions">
          <button data-testid="admin-scaffold-back" onClick={handleBack} className="btn">
            Back to chat
          </button>
          {dirty && (
            <span data-testid="admin-scaffold-dirty" className="muted">
              unsaved changes
            </span>
          )}
          <button
            data-testid="admin-scaffold-save"
            type="submit"
            disabled={!dirty || saving}
            className="btn primary"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AdminUsersView({
  onLogout,
  currentUserId,
}: {
  onLogout: () => void;
  currentUserId: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/admin/users", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("failed to load users");
        return UserListSchema.parse(await res.json());
      })
      .then((data) => {
        if (!mounted) return;
        setUsers(data);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Failed to load users.");
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const target = users.find((u) => u.id === confirmingId);
  const confirmed = !!target && confirmInput === target.email;

  const handleDelete = (id: string) => {
    setConfirmingId(id);
    setConfirmInput("");
  };

  const handleCancel = () => {
    setConfirmingId(null);
    setConfirmInput("");
  };

  const handleConfirm = async () => {
    if (!confirmingId || !confirmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${confirmingId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to delete user.");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== confirmingId));
      setConfirmingId(null);
      setConfirmInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setConfirmingId(null);
      setConfirmInput("");
    }
  };

  return (
    <div className="page" data-testid="admin-users-page">
      <h1 data-testid="admin-users-heading">Users</h1>
      <button data-testid="admin-logout" onClick={onLogout} className="btn" style={{ marginBottom: 12 }}>
        Sign out
      </button>
      {error && <div data-testid="admin-users-error">{error}</div>}
      {loading ? (
        <div data-testid="admin-users-loading">Loading…</div>
      ) : (
        <ul data-testid="admin-user-list">
          {users.map((u) => (
            <li key={u.id} data-testid="admin-user-row">
              {u.email} — {u.displayName ?? "(no display name)"} —
              {u.isAdmin ? "admin" : "user"} —{" "}
              {new Date(u.createdAt).toLocaleString()}
              {u.id === currentUserId ? (
                <span data-testid="admin-user-self"> (you)</span>
              ) : (
                <>
                  <button
                    data-testid="admin-user-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(u.id);
                    }}
                    className="delete-btn"
                  >
                    delete
                  </button>
                  {confirmingId === u.id && (
                    <div data-testid="admin-user-confirm" className="confirm">
                      Type <strong>{u.email}</strong> to confirm:
                      <input
                        data-testid="admin-user-confirm-input"
                        value={confirmInput}
                        onChange={(e) => setConfirmInput(e.target.value)}
                      />
                      <button
                        data-testid="admin-user-confirm-submit"
                        onClick={handleConfirm}
                        disabled={!confirmed}
                        className="btn primary"
                      >
                        Delete
                      </button>
                      <button
                        data-testid="admin-user-confirm-cancel"
                        onClick={handleCancel}
                        className="btn"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
