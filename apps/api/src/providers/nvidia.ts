import { ProviderError } from "./provider-error.js";
import type { Provider, ProviderName, ProviderRequest, ChatMessage, StreamEvent } from "./registry.js";

const NVIDIA_NAME: ProviderName = "nvidia";

const NVIDIA_HINT_STATUSES = new Set([404, 410, 451]);

export class NvidiaProvider implements Provider {
  readonly name = NVIDIA_NAME;

  constructor(
    readonly baseUrl: string,
    readonly apiKey?: string,
  ) {}

  async testCompletion(options: { model: string }): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        max_tokens: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw this.mapError({ status: res.status, body });
    }
    await res.text();
  }

  buildChatRequest(options: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
  }): ProviderRequest {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return {
      url,
      headers,
      body: {
        model: options.model,
        messages: options.messages,
        stream: options.stream ?? true,
        temperature: 0.7,
        max_tokens: 1024,
      },
    };
  }

  parseLine(line: string): StreamEvent[] {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") {
      return [];
    }

    const prefix = "data: ";
    if (!trimmed.startsWith(prefix)) {
      return [];
    }

    const payload = trimmed.slice(prefix.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return [];
    }

    const event = parsed as {
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string };
        finish_reason?: string | null;
      }>;
    };

    const events: StreamEvent[] = [];
    const delta = event.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      events.push({ reasoning: delta.reasoning_content });
    }
    if (delta?.content) {
      events.push({ text: delta.content });
    }
    if (event.choices?.[0]?.finish_reason) {
      events.push({ done: true });
    }
    return events;
  }

  mapError(options: { status: number; body: string }): ProviderError {
    let message = `NVIDIA provider error (HTTP ${options.status})`;
    let hint: string | undefined;

    try {
      const parsed = JSON.parse(options.body);
      const providerMessage =
        parsed?.message ?? parsed?.error?.message ?? parsed?.error;
      if (typeof providerMessage === "string") {
        message = providerMessage;
      }
    } catch {
      // keep default message
    }

    if (NVIDIA_HINT_STATUSES.has(options.status)) {
      hint = "model not enabled for this NVIDIA org";
    }

    return new ProviderError(options.status, message, hint);
  }
}
