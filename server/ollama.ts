export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export interface OllamaResponse {
  response: string;
  done: boolean;
}

export class OllamaAdapter {
  private config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: config?.model || process.env.OLLAMA_MODEL || "codellama",
    };
  }

  async generate(prompt: string, onToken?: (token: string) => void): Promise<string> {
    const url = `${this.config.baseUrl}/api/generate`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          stream: !!onToken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      if (onToken && response.body) {
        // Handle streaming response
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
        // Handle non-streaming response
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
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: !!onToken,
        }),
      });

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
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map((m: { name: string }) => m.name) || [];
    } catch {
      return [];
    }
  }
}

export const ollama = new OllamaAdapter();
