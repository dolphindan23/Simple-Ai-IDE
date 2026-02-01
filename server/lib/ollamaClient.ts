const OLLAMA_BASE_URL = process.env.OLLAMA_INTERNAL_URL || process.env.LLM_BASE_URL || "http://ollama:11434";

export async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${OLLAMA_BASE_URL}${path}`;
  const res = await fetch(url, init);
  return res;
}

export async function ollamaJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await ollamaFetch(path, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status} ${res.statusText}: ${txt}`);
  }
  return (await res.json()) as T;
}

export function getOllamaBaseUrl(): string {
  return OLLAMA_BASE_URL;
}
