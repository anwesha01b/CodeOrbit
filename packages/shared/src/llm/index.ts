// Provider-agnostic LLM + embedding layer (spec §8.1 design rule).
// Imported only by api + worker (node), never by the web bundle.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** "document" for indexed chunks, "query" for the user's question. */
export type EmbedKind = "document" | "query";

export interface CompleteOptions {
  json?: boolean;
}

export interface LlmProvider {
  name: string;
  embedDim: number;
  isAvailable(): Promise<boolean>;
  embed(texts: string[], kind?: EmbedKind): Promise<number[][]>;
  /** `json: true` asks the model for a single JSON object (used for batched summaries). */
  complete(system: string, user: string, opts?: CompleteOptions): Promise<string>;
  stream(system: string, messages: ChatMessage[]): AsyncGenerator<string>;
}

import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { MockProvider } from "./mock.js";

/** Select the provider from LLM_PROVIDER (gemini | ollama | mock). */
export function getProvider(): LlmProvider {
  const name = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  switch (name) {
    case "ollama":
      return new OllamaProvider();
    case "mock":
      return new MockProvider();
    case "gemini":
    default:
      return new GeminiProvider();
  }
}
