import { useEffect, useState } from "react";
import { HealthResponseSchema } from "@jean/shared";
import type { HealthResponse } from "@jean/shared";

function App() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`health check failed: HTTP ${res.status}`);
        }
        return HealthResponseSchema.parse(await res.json());
      })
      .then((payload) => {
        if (mounted) setData(payload);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (error) {
    return <div data-testid="health-error">error: {error}</div>;
  }
  if (!data) {
    return <div data-testid="health-loading">loading…</div>;
  }

  return (
    <div data-testid="health">
      {data.status}: {data.value}
    </div>
  );
}

export default App;
