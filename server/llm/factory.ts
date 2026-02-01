import { OllamaAdapter, OllamaConfig } from "../ollama";
import { OpenAICompatAdapter, OpenAICompatConfig } from "../openai_compat";

export type LLMBackend = "ollama" | "vllm" | "openai";

export interface LLMAdapter {
  generate(prompt: string, onToken?: (token: string) => void): Promise<string>;
  chat(messages: { role: string; content: string }[], onToken?: (token: string) => void): Promise<string>;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<string[]>;
}

export function getLLMBackend(): LLMBackend {
  const backend = (process.env.LLM_BACKEND || "ollama").toLowerCase();
  if (backend === "vllm" || backend === "openai") {
    return backend as LLMBackend;
  }
  return "ollama";
}

export function resolveLLMConfig(): { baseUrl: string; model: string } {
  const backend = getLLMBackend();
  
  if (backend === "vllm" || backend === "openai") {
    return {
      baseUrl: process.env.LLM_BASE_URL || "http://vllm:8000/v1",
      model: process.env.VLLM_MODEL || process.env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct",
    };
  }
  
  return {
    baseUrl: process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || process.env.LLM_MODEL || "qwen2.5:7b",
  };
}

export function getLLMAdapter(config?: Partial<OllamaConfig | OpenAICompatConfig>): LLMAdapter {
  const backend = getLLMBackend();
  const resolved = resolveLLMConfig();
  
  if (backend === "vllm" || backend === "openai") {
    return new OpenAICompatAdapter({
      baseUrl: config?.baseUrl || resolved.baseUrl,
      model: config?.model || resolved.model,
      ...config,
    });
  }
  
  return new OllamaAdapter({
    baseUrl: config?.baseUrl || resolved.baseUrl,
    model: config?.model || resolved.model,
    ...config,
  });
}

export function createAdapterForBackend(
  backendType: LLMBackend,
  baseUrl: string,
  model: string,
  options?: Partial<OllamaConfig | OpenAICompatConfig>
): LLMAdapter {
  if (backendType === "vllm" || backendType === "openai") {
    return new OpenAICompatAdapter({
      baseUrl,
      model,
      ...options,
    });
  }
  
  return new OllamaAdapter({
    baseUrl,
    model,
    ...options,
  });
}

let defaultAdapter: LLMAdapter | null = null;

export function getDefaultLLMAdapter(): LLMAdapter {
  if (!defaultAdapter) {
    defaultAdapter = getLLMAdapter();
  }
  return defaultAdapter;
}

export function resetDefaultAdapter(): void {
  defaultAdapter = null;
}
