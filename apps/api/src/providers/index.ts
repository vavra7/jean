import { type ProviderRegistry, type ProviderName } from "./registry.js";
import { NvidiaProvider } from "./nvidia.js";
import { OllamaProvider } from "./ollama.js";

export function buildProviderRegistry(env: {
  NVIDIA_BASE_URL: string;
  NVIDIA_API_KEY?: string;
  OLLAMA_BASE_URL: string;
}): ProviderRegistry {
  const providers: Record<ProviderName, import("./registry.js").Provider> = {
    nvidia: new NvidiaProvider(env.NVIDIA_BASE_URL, env.NVIDIA_API_KEY),
    ollama: new OllamaProvider(env.OLLAMA_BASE_URL),
  };

  return {
    get(name: ProviderName) {
      return providers[name];
    },
    has(name: ProviderName) {
      return name in providers;
    },
  };
}
