import { useCallback, useEffect, useRef, useState } from "react";
import {
  AcceptInviteSchema,
  AuthMeSchema,
  InviteListSchema,
  ModelListSchema,
  MessageListSchema,
  ThreadListSchema,
} from "@jean/shared";
import type { AuthMe, Invite, Message, Model, Thread } from "@jean/shared";

type Route = "/login" | "/chat" | "/invite" | "/admin/invites";

function routeOf(pathname: string): Route {
  if (pathname === "/login") return "/login";
  if (pathname === "/chat") return "/chat";
  if (pathname === "/admin/invites") return "/admin/invites";
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

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, "", to);
    setRoute(routeOf(to));
  }, []);

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
    navigate("/login");
  }, [navigate]);

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
  return <ChatView user={user} onLogout={logout} onManageInvites={() => navigate("/admin/invites")} />;
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
  onLogout,
  onManageInvites,
}: {
  user: AuthMe;
  onLogout: () => void;
  onManageInvites: () => void;
}) {
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
    try {
      const res = await fetch(`/api/threads/${currentThreadId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
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
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
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
                <button data-testid="chat-manage-invites" onClick={onManageInvites} className="icon-btn">
                  Invites
                </button>
              )}
              <button
                data-testid="chat-logout"
                onClick={onLogout}
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
                {sending && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Streaming…</div>}
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

export default App;
