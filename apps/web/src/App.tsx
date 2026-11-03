import { useCallback, useEffect, useState } from "react";
import { AuthMeSchema, AcceptInviteSchema, InviteListSchema } from "@jean/shared";
import type { AuthMe, Invite } from "@jean/shared";

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

function App() {
  const [user, setUser] = useState<AuthMe | null>(null);
  const [route, setRoute] = useState<Route>("/login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, "", to);
    setRoute(routeOf(to));
  }, []);

  // Resolve auth state on load: anonymous visitors are sent to /login;
  // signed-in visitors go to the chat. The public /invite/:token page is
  // exempt from the redirect.
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
          // Signed in: /login and /admin/invites (non-admin) → /chat.
          if (current === "/login") {
            navigate("/chat");
          } else if (current === "/admin/invites" && !me.isAdmin) {
            navigate("/chat");
          }
          return;
        }
        // Anonymous: only the public invite page is allowed; everything else → /login.
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

  // Public invite accept page: no session required.
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
    // Anonymous: / (and any non-login, non-invite path) redirects to /login.
    if (route === "/login") {
      return <LoginView onLogin={login} error={error} />;
    }
    navigate("/login");
    return <div data-testid="auth-redirect">redirecting to /login…</div>;
  }
  // Signed in: /login redirects to the chat.
  if (route === "/login") {
    navigate("/chat");
    return <div data-testid="auth-redirect">redirecting to /chat…</div>;
  }
  // Admin invites management (admin only).
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
    <div data-testid="login-page">
      <h1 data-testid="login-heading">Sign in</h1>
      {error && <div data-testid="login-error">{error}</div>}
      <form data-testid="login-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            data-testid="login-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            data-testid="login-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          data-testid="login-submit"
          type="submit"
          disabled={submitting}
        >
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
      <div data-testid="invite-invalid">
        <h1 data-testid="invite-heading">Invite not valid</h1>
        <p>This invite link is invalid, has already been used, or has expired.</p>
      </div>
    );
  }
  if (step === "success") {
    return (
      <div data-testid="invite-success">
        <h1 data-testid="invite-heading">Account created</h1>
        <p>You are signed in. Redirecting to chat…</p>
      </div>
    );
  }
  return (
    <div data-testid="invite-page">
      <h1 data-testid="invite-heading">Set up your account</h1>
      <p>Create a password for {email}</p>
      <form data-testid="invite-form" onSubmit={handleSubmit}>
        <label>
          Display name
          <input
            data-testid="invite-display-name"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            data-testid="invite-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div data-testid="invite-error">{error}</div>}
        <button
          data-testid="invite-submit"
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
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
  return (
    <div data-testid="chat-page">
      <h1 data-testid="chat-heading">Chat</h1>
      <div data-testid="chat-user">
        Signed in as {user.email} ({user.isAdmin ? "admin" : "user"}).
      </div>
      {user.isAdmin && (
        <button data-testid="chat-manage-invites" onClick={onManageInvites}>
          Manage invites
        </button>
      )}
      <button data-testid="chat-logout" onClick={onLogout}>
        Sign out
      </button>
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
    <div data-testid="admin-invites-page">
      <h1 data-testid="admin-invites-heading">Invites</h1>
      <button data-testid="admin-logout" onClick={onLogout}>
        Sign out
      </button>
      {error && <div data-testid="admin-invites-error">{error}</div>}
      <form data-testid="admin-invite-create" onSubmit={handleCreate}>
        <label>
          Email
          <input
            data-testid="admin-invite-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button data-testid="admin-invite-create-submit" type="submit" disabled={creating}>
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
