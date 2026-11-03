import { ProviderError } from "./provider-error.js";
import type { Provider, ProviderName, ProviderRequest, ChatMessage, StreamEvent } from "./registry.js";

const OLLAMA_NAME: ProviderName = "ollama";

export class OllamaProvider implements Provider {
  readonly name = OLLAMA_NAME;

  constructor(
    readonly baseUrl: string,
    readonly apiKey?: string,
  ) {}

  async testCompletion(options: { model: string }): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.mapError({ status: res.status, body });
    }
    await res.text();
  }

  async discoverModels(): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/tags`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.mapError({ status: res.status, body });
    }
    const parsed = (await res.json()) as { models?: Array<{ name: string }> };
    return (parsed.models ?? []).map((m) => m.name);
  }

  buildChatRequest(options: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
  }): ProviderRequest {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    return {
      url,
      headers,
      body: {
        model: options.model,
        messages: options.messages,
        stream: options.stream ?? true,
      },
    };
  }

  parseLine(line: string): StreamEvent[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }

    const event = parsed as {
      message?: { role?: string; content?: string };
      done?: boolean;
    };

    const events: StreamEvent[] = [];
    if (event.message?.content) {
      events.push({ text: event.message.content });
    }
    if (event.done) {
      events.push({ done: true });
    }
    return events;
  }

  mapError(options: { status: number; body: string }): ProviderError {
    let message = `Ollama provider error (HTTP ${options.status})`;
    try {
      const parsed = JSON.parse(options.body);
      const providerMessage = parsed?.error;
      if (typeof providerMessage === "string") {
        message = providerMessage;
      }
    } catch {
      // keep default message
    }
    return new ProviderError(options.status, message);
  }
}
