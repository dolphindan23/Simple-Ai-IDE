export interface OllamaConfig {
  baseUrl: string;
  model: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
}

export interface OllamaProvider {
  id: string;
  url: string;
  defaultModel: string;
}

export interface OllamaResponse {
  response: string;
  done: boolean;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_BACKOFF_MS = 250;

function parseProvidersJson(): OllamaProvider[] | null {
  const json = process.env.OLLAMA_PROVIDERS_JSON;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(p => p.id && p.url);
  } catch {
    console.warn("Failed to parse OLLAMA_PROVIDERS_JSON, using defaults");
    return null;
  }
}

function getDefaultConfig(): OllamaConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "codellama",
    connectTimeoutMs: parseInt(process.env.OLLAMA_CONNECT_TIMEOUT_MS || "") || DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: parseInt(process.env.OLLAMA_REQUEST_TIMEOUT_MS || "") || DEFAULT_REQUEST_TIMEOUT_MS,
    retryCount: parseInt(process.env.OLLAMA_RETRY_COUNT || "") || DEFAULT_RETRY_COUNT,
    retryBackoffMs: parseInt(process.env.OLLAMA_RETRY_BACKOFF_MS || "") || DEFAULT_RETRY_BACKOFF_MS,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OllamaAdapter {
  private config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    const defaults = getDefaultConfig();
    this.config = {
      baseUrl: config?.baseUrl || defaults.baseUrl,
      model: config?.model || defaults.model,
      connectTimeoutMs: config?.connectTimeoutMs ?? defaults.connectTimeoutMs,
      requestTimeoutMs: config?.requestTimeoutMs ?? defaults.requestTimeoutMs,
      retryCount: config?.retryCount ?? defaults.retryCount,
      retryBackoffMs: config?.retryBackoffMs ?? defaults.retryBackoffMs,
    };
  }

  getConfig(): OllamaConfig {
    return { ...this.config };
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    let lastError: Error | null = null;
    const attempts = this.config.retryCount + 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < attempts) {
          const backoff = this.config.retryBackoffMs * attempt;
          await sleep(backoff);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  async generate(prompt: string, onToken?: (token: string) => void): Promise<string> {
    const url = `${this.config.baseUrl}/api/generate`;
    
    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            stream: !!onToken,
          }),
        },
        this.config.requestTimeoutMs
      );

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      if (onToken && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter(Boolean);
          
          for (const line of lines) {
            try {
              const data: OllamaResponse = JSON.parse(line);
              if (data.response) {
                fullResponse += data.response;
                onToken(data.response);
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }

        return fullResponse;
      } else {
        const data = await response.json();
        return data.response;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Ollama connection failed: ${message}. Make sure Ollama is running at ${this.config.baseUrl}`);
    }
  }

  async chat(messages: { role: string; content: string }[], onToken?: (token: string) => void): Promise<string> {
    const url = `${this.config.baseUrl}/api/chat`;
    
    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            stream: !!onToken,
          }),
        },
        this.config.requestTimeoutMs
      );

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      if (onToken && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter(Boolean);
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                fullResponse += data.message.content;
                onToken(data.message.content);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }

        return fullResponse;
      } else {
        const data = await response.json();
        return data.message?.content || "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Ollama connection failed: ${message}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry(
        `${this.config.baseUrl}/api/tags`,
        { method: "GET" },
        this.config.connectTimeoutMs
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.fetchWithRetry(
        `${this.config.baseUrl}/api/tags`,
        { method: "GET" },
        this.config.connectTimeoutMs
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map((m: { name: string }) => m.name) || [];
    } catch {
      return [];
    }
  }
}

export function getProviders(): OllamaProvider[] {
  const jsonProviders = parseProvidersJson();
  if (jsonProviders && jsonProviders.length > 0) {
    return jsonProviders;
  }
  
  const defaultConfig = getDefaultConfig();
  return [{
    id: "default",
    url: defaultConfig.baseUrl,
    defaultModel: defaultConfig.model,
  }];
}

export function createAdapterForProvider(providerId: string): OllamaAdapter | null {
  const providers = getProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return null;
  
  const defaults = getDefaultConfig();
  return new OllamaAdapter({
    baseUrl: provider.url,
    model: provider.defaultModel || defaults.model,
  });
}

export const ollama = new OllamaAdapter();
