import type { ChatMessage, CompleteOptions, LlmProvider } from "./index.js";

/** Local Ollama (fully offline). nomic-embed-text → 768 dims. */
export class OllamaProvider implements LlmProvider {
  name = "ollama";
  embedDim = 768;
  private base = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  private model = () => process.env.OLLAMA_MODEL ?? "llama3.2";
  private embedModel = () => process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base()}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.base()}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.embedModel(), prompt: text }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
      const data = (await res.json()) as { embedding: number[] };
      out.push(data.embedding);
    }
    return out;
  }

  async complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
    const res = await fetch(`${this.base()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model(), system, prompt: user, stream: false, ...(opts.json ? { format: "json" } : {}) }),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
    const data = (await res.json()) as { response: string };
    return data.response;
  }

  async *stream(system: string, messages: ChatMessage[]): AsyncGenerator<string> {
    const res = await fetch(`${this.base()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model(),
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama chat failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) yield json.message.content as string;
        } catch {
          // ignore partial lines
        }
      }
    }
  }
}
