export interface OpenAICompatConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  orgId?: string;
  projectId?: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface OpenAIChatChoice {
  index: number;
  message?: { role: string; content: string };
  delta?: { role?: string; content?: string };
  finish_reason: string | null;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAIModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_BACKOFF_MS = 250;

function getDefaultConfig(): OpenAICompatConfig {
  const backend = process.env.LLM_BACKEND || "ollama";
  const defaultBaseUrl = backend === "vllm" ? "http://vllm:8000/v1" : "http://localhost:11434/v1";
  const defaultModel = process.env.VLLM_MODEL || process.env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct";

  return {
    baseUrl: process.env.LLM_BASE_URL || defaultBaseUrl,
    model: defaultModel,
    apiKey: process.env.OPENAI_API_KEY,
    orgId: process.env.OPENAI_ORG_ID,
    projectId: process.env.OPENAI_PROJECT_ID,
    connectTimeoutMs: parseInt(process.env.OPENAI_CONNECT_TIMEOUT_MS || "") || DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS || "") || DEFAULT_REQUEST_TIMEOUT_MS,
    retryCount: parseInt(process.env.OPENAI_RETRY_COUNT || "") || DEFAULT_RETRY_COUNT,
    retryBackoffMs: parseInt(process.env.OPENAI_RETRY_BACKOFF_MS || "") || DEFAULT_RETRY_BACKOFF_MS,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OpenAICompatAdapter {
  private config: OpenAICompatConfig;

  constructor(config?: Partial<OpenAICompatConfig>) {
    const defaults = getDefaultConfig();
    this.config = {
      baseUrl: config?.baseUrl || defaults.baseUrl,
      model: config?.model || defaults.model,
      apiKey: config?.apiKey ?? defaults.apiKey,
      orgId: config?.orgId ?? defaults.orgId,
      projectId: config?.projectId ?? defaults.projectId,
      connectTimeoutMs: config?.connectTimeoutMs ?? defaults.connectTimeoutMs,
      requestTimeoutMs: config?.requestTimeoutMs ?? defaults.requestTimeoutMs,
      retryCount: config?.retryCount ?? defaults.retryCount,
      retryBackoffMs: config?.retryBackoffMs ?? defaults.retryBackoffMs,
    };
  }

  getConfig(): OpenAICompatConfig {
    return { ...this.config };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.orgId) {
      headers["OpenAI-Organization"] = this.config.orgId;
    }
    if (this.config.projectId) {
      headers["OpenAI-Project"] = this.config.projectId;
    }
    return headers;
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
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    return this.chat(messages, onToken);
  }

  async chat(messages: ChatMessage[], onToken?: (token: string) => void): Promise<string> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify({
            model: this.config.model,
            messages,
            stream: !!onToken,
          }),
        },
        this.config.requestTimeoutMs
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`OpenAI-compat request failed: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      if (onToken && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter(line => line.startsWith("data: "));

          for (const line of lines) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed: OpenAIChatResponse = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                onToken(content);
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }

        return fullResponse;
      } else {
        const data: OpenAIChatResponse = await response.json();
        return data.choices[0]?.message?.content || "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`OpenAI-compat connection failed: ${message}. Make sure the server is running at ${this.config.baseUrl}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/models`;
      const response = await this.fetchWithRetry(
        url,
        { method: "GET", headers: this.getHeaders() },
        this.config.connectTimeoutMs
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/models`;
      const response = await this.fetchWithRetry(
        url,
        { method: "GET", headers: this.getHeaders() },
        this.config.connectTimeoutMs
      );
      if (!response.ok) return [];
      const data: OpenAIModelsResponse = await response.json();
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }
}
