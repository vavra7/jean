import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadEnv } from "./env.js";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const required = [
  "DATABASE_URL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "NVIDIA_API_KEY",
];

function setValidEnv() {
  process.env.DATABASE_URL = "postgres://jean:jean@127.0.0.1:5432/jean";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "password-must-be-at-least-eight";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.NVIDIA_API_KEY = "nvapi-test-key";
}

function deleteRequired() {
  for (const key of required) {
    delete process.env[key];
  }
}

describe("loadEnv", () => {
  it("parses valid env and applies defaults", () => {
    setValidEnv();
    const env = loadEnv();
    expect(env.DATABASE_URL).toBe("postgres://jean:jean@127.0.0.1:5432/jean");
    expect(env.ADMIN_EMAIL).toBe("admin@example.com");
    expect(env.NVIDIA_BASE_URL).toBe("https://integrate.api.nvidia.com/v1");
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(env.PUBLIC_ORIGIN).toBe("http://localhost:5173");
    expect(env.PORT).toBe("3000");
  });

  it("fails fast with a clear message when a required var is missing", () => {
    setValidEnv();
    deleteRequired();

    const exitCode: number[] = [];
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((code) => {
        exitCode.push(code as number);
        throw new Error(`process.exit(${code})`);
      });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => loadEnv()).toThrow("process.exit(1)");
    expect(exitCode).toEqual([1]);
    const message = error.mock.calls[0][0] as string;
    expect(message).toContain("Missing or invalid required env vars");
    expect(message).toContain("DATABASE_URL");
  });

  it("fails fast when a required var is present but invalid", () => {
    setValidEnv();
    process.env.ADMIN_EMAIL = "not-an-email";

    const exitCode: number[] = [];
    vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode.push(code as number);
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => loadEnv()).toThrow("process.exit(1)");
    expect(exitCode).toEqual([1]);
  });
});
