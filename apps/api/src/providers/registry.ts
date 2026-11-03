import { ProviderError } from "./provider-error.js";

export type ProviderName = "nvidia" | "ollama";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamEvent {
  reasoning?: string;
  text?: string;
  done?: boolean;
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Provider {
  readonly name: ProviderName;
  readonly baseUrl: string;
  readonly apiKey?: string;

  /** Run a minimal completion to prove the model works. Throws ProviderError on failure. */
  testCompletion(options: { model: string }): Promise<void>;

  /** Build the upstream chat completion request. */
  buildChatRequest(options: {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
  }): ProviderRequest;

  /** Parse one upstream line into stream events (may yield zero or more). */
  parseLine(line: string): StreamEvent[];

  /** Map an upstream error response into a ProviderError. */
  mapError(options: {
    status: number;
    body: string;
  }): ProviderError;

  /** List available model ids (ollama only). */
  discoverModels?(): Promise<string[]>;
}

export interface ProviderRegistry {
  get(name: ProviderName): Provider;
  has(name: ProviderName): boolean;
}
