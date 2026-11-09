import type { ChatMessage, CompleteOptions, LlmProvider } from "./index.js";

/**
 * Offline test/dev provider. Deterministic lexical-hash embeddings (so retrieval
 * is mechanically correct and roughly keyword-relevant) and canned text, so the
 * whole RAG pipeline can be verified with no external service or key.
 */
export class MockProvider implements LlmProvider {
  name = "mock";
  embedDim = 768;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbed(t, this.embedDim));
  }

  async complete(_system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
    if (opts.json) {
      // batched prompts list items as "File: <path>" / "Module: <id>" — answer each
      const keys = [...user.matchAll(/^(?:File|Module): (\S+)/gm)].map((m) => m[1]);
      return JSON.stringify(Object.fromEntries(keys.map((k) => [k, `(mock) summary of ${k}`])));
    }
    const firstLine = user.split("\n").find((l) => l.trim().length > 20) ?? user;
    return `(mock) ${firstLine.trim().slice(0, 150)}…`;
  }

  async *stream(_system: string, messages: ChatMessage[]): AsyncGenerator<string> {
    const q = messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const question = q.split("Question:").pop()?.trim().slice(0, 120) ?? q.slice(0, 120);
    const words =
      `Based on the retrieved code, here is a grounded answer to "${question}". ` +
      `This is an offline mock response — add a GEMINI_API_KEY (or run Ollama) for real answers. ` +
      `See the cited files below.`;
    for (const w of words.split(" ")) {
      yield w + " ";
      await new Promise((r) => setTimeout(r, 12));
    }
  }
}

/** FNV-1a token hashing into a normalized bag-of-words vector. */
function hashEmbed(text: string, dim: number): number[] {
  const v = new Array(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % dim] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
