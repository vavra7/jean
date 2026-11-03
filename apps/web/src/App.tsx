import { useCallback, useEffect, useState } from "react";
import { AuthMeSchema } from "@jean/shared";
import type { AuthMe } from "@jean/shared";

type Route = "/login" | "/chat";

function App() {
  const [user, setUser] = useState<AuthMe | null>(null);
  const [route, setRoute] = useState<Route>("/login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useCallback((to: Route) => {
    window.history.pushState({}, "", to);
    setRoute(to);
  }, []);

  // Resolve auth state on load: anonymous visitors to / are redirected to /login;
  // signed-in visitors go to the chat.
  useEffect(() => {
    let mounted = true;
    const onPopState = () => {
      if (!mounted) return;
      setRoute((window.location.pathname as Route) || "/login");
    };
    window.addEventListener("popstate", onPopState);

    fetch("/api/auth/me", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        return AuthMeSchema.parse(await res.json());
      })
      .then((me) => {
        if (!mounted) return;
        setUser(me ?? null);
        setLoading(false);
        const current = (window.location.pathname as Route) || "/login";
        if (!me) {
          // Anonymous: / (and any non-login path) redirects to /login.
          if (current !== "/login") navigate("/login");
        } else if (current === "/login") {
          // Signed in on /login: redirect to the chat.
          navigate("/chat");
        }
      })
      .catch(() => {
        if (!mounted) return;
        setLoading(false);
        setUser(null);
        if ((window.location.pathname as Route) !== "/login") navigate("/login");
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

  if (!user) {
    // Anonymous: / (and any non-login path) redirects to /login.
    if (route === "/login") {
      return <LoginView onLogin={login} error={error} />;
    }
    navigate("/login");
    return <div data-testid="auth-redirect">redirecting to /login…</div>;
  }
  // Signed in: /login redirects to the chat; render the chat.
  if (route === "/login") {
    navigate("/chat");
    return <div data-testid="auth-redirect">redirecting to /chat…</div>;
  }
  return <ChatView user={user} onLogout={logout} />;
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

function ChatView({ user, onLogout }: { user: AuthMe; onLogout: () => void }) {
  return (
    <div data-testid="chat-page">
      <h1 data-testid="chat-heading">Chat</h1>
      <div data-testid="chat-user">
        Signed in as {user.email} ({user.isAdmin ? "admin" : "user"}).
      </div>
      <button data-testid="chat-logout" onClick={onLogout}>
        Sign out
      </button>
    </div>
  );
}

export default App;
