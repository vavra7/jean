import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NvidiaProvider } from "./nvidia.js";
import { OllamaProvider } from "./ollama.js";
import { ProviderError } from "./provider-error.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

function mockFetch(response: Response) {
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("NvidiaProvider", () => {
  it("builds an OpenAI-compatible chat request with bearer auth", () => {
    const provider = new NvidiaProvider(
      "https://integrate.api.nvidia.com/v1",
      "nvapi-key",
    );
    const req = provider.buildChatRequest({
      model: "nvidia/nemotron",
      messages: [
        { role: "system", content: "You are Jean" },
        { role: "user", content: "hi" },
      ],
      stream: true,
    });

    expect(req.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer nvapi-key");
    expect(req.headers.Accept).toBe("text/event-stream");
    const body = req.body as {
      model: string;
      stream: boolean;
      temperature: number;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body).toMatchObject({
      model: "nvidia/nemotron",
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    });
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are Jean",
    });
  });

  it("extracts reasoning and text deltas from SSE lines", () => {
    const provider = new NvidiaProvider("https://integrate.api.nvidia.com/v1");

    const reasoning = provider.parseLine(
      'data: {"choices":[{"delta":{"reasoning_content":"let me think"}}]}',
    );
    expect(reasoning).toEqual([{ reasoning: "let me think" }]);

    const text = provider.parseLine(
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
    );
    expect(text).toEqual([{ text: "hello" }]);

    const both = provider.parseLine(
      'data: {"choices":[{"delta":{"reasoning_content":"x","content":"y"}}]}',
    );
    expect(both).toEqual([{ reasoning: "x" }, { text: "y" }]);

    expect(provider.parseLine("data: [DONE]")).toEqual([]);
    expect(provider.parseLine(": heartbeat")).toEqual([]);
    expect(provider.parseLine("garbage")).toEqual([]);
  });

  it("testCompletion passes through a successful response", async () => {
    const provider = new NvidiaProvider(
      "https://integrate.api.nvidia.com/v1",
      "nvapi-key",
    );
    mockFetch(new Response("", { status: 200 }));
    await expect(provider.testCompletion({ model: "nvidia/nemotron" })).resolves.toBeUndefined();
  });

  it("maps a 422 provider error verbatim", async () => {
    const provider = new NvidiaProvider("https://integrate.api.nvidia.com/v1");
    mockFetch(jsonResponse({ message: "model not found" }, 422));

    await expect(
      provider.testCompletion({ model: "nvidia/nemotron" }),
    ).rejects.toMatchObject({
      status: 422,
      message: "model not found",
      hint: undefined,
    });
  });

  it("adds the NVIDIA org hint on 404/410/451", async () => {
    const provider = new NvidiaProvider("https://integrate.api.nvidia.com/v1");
    for (const status of [404, 410, 451]) {
      mockFetch(jsonResponse({ message: "not found" }, status));
      let caught: ProviderError | undefined;
      try {
        await provider.testCompletion({ model: "nvidia/nemotron" });
      } catch (e) {
        caught = e as ProviderError;
      }
      expect(caught).toBeInstanceOf(ProviderError);
      expect(caught?.status).toBe(status);
      expect(caught?.hint).toBe("model not enabled for this NVIDIA org");
    }
  });
});

describe("OllamaProvider", () => {
  it("builds an ollama chat request", () => {
    const provider = new OllamaProvider("http://localhost:11434");
    const req = provider.buildChatRequest({
      model: "llama3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    expect(req.url).toBe("http://localhost:11434/api/chat");
    const body = req.body as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body).toMatchObject({ model: "llama3", stream: true });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("parses NDJSON chunks into text and done events", () => {
    const provider = new OllamaProvider("http://localhost:11434");

    expect(provider.parseLine('{"message":{"content":"hel"}}')).toEqual([
      { text: "hel" },
    ]);
    expect(provider.parseLine('{"done":true}')).toEqual([{ done: true }]);
    expect(provider.parseLine("")).toEqual([]);
    expect(provider.parseLine("not json")).toEqual([]);
  });

  it("discovers models from /api/tags", async () => {
    const provider = new OllamaProvider("http://localhost:11434");
    mockFetch(
      jsonResponse({ models: [{ name: "llama3" }, { name: "mistral" }] }),
    );
    const ids = await provider.discoverModels();
    expect(ids).toEqual(["llama3", "mistral"]);
  });

  it("maps an ollama error verbatim", async () => {
    const provider = new OllamaProvider("http://localhost:11434");
    mockFetch(jsonResponse({ error: "model not found" }, 404));

    await expect(
      provider.testCompletion({ model: "llama3" }),
    ).rejects.toMatchObject({ status: 404, message: "model not found" });
  });
});
