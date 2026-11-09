import type { ChatMessage, CompleteOptions, EmbedKind, LlmProvider } from "./index.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sliding-window limiter (units per minute). Free-tier quotas are per project *per model*
 * (e.g. flash-lite: 15 req/min; embeddings: 100 items/min), so we pace ourselves rather
 * than burst into 429s. Limiters are module-level so every provider instance shares them.
 */
class RateLimiter {
  private stamps: number[] = [];
  constructor(private perMinute: number) {}
  async take(units = 1): Promise<void> {
    const need = Math.min(units, this.perMinute);
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length + need <= this.perMinute) {
        for (let i = 0; i < need; i++) this.stamps.push(now);
        return;
      }
      await sleep(60_000 - (now - this.stamps[0]) + 100);
    }
  }
}

const GENERATE_RPM = Number(process.env.GEMINI_RPM ?? 14);
const limiters = new Map<string, RateLimiter>();
const limiterFor = (model: string, perMinute = GENERATE_RPM) => {
  let l = limiters.get(model);
  if (!l) limiters.set(model, (l = new RateLimiter(perMinute)));
  return l;
};
/** model → epoch ms until which it is skipped (quota exhausted / unavailable). */
const cooldown = new Map<string, number>();
const EMBED_PER_MIN = Number(process.env.GEMINI_EMBED_PER_MIN ?? 90);
const EMBED_BATCH = 25;

interface Attempt {
  res: Response;
  /** quota that will not recover soon (daily cap) — don't wait, fall back */
  exhaustedForMs: number;
}

/**
 * Retry short-lived 429/503s, honouring Gemini's RetryInfo delay. A long delay (daily
 * quota) is reported immediately instead of blocking the request for minutes.
 */
async function fetchRetry(url: string, init: RequestInit, tries = 4): Promise<Attempt> {
  let res!: Response;
  for (let i = 0; i < tries; i++) {
    res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 503) return { res, exhaustedForMs: 0 };
    let wait = 1500 * (i + 1);
    try {
      const body = (await res.clone().json()) as {
        error?: { details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] };
      };
      const details = body.error?.details ?? [];
      const delayMs = (parseFloat(details.find((d) => d.retryDelay)?.retryDelay ?? "0") || 0) * 1000;
      const perDay = details.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
      if (perDay || delayMs > 90_000) return { res, exhaustedForMs: Math.max(delayMs, 3_600_000) };
      wait = Math.max(wait, delayMs + 500);
    } catch {
      /* non-JSON body */
    }
    await sleep(Math.min(wait, 60_000));
  }
  return { res, exhaustedForMs: res.status === 503 ? 120_000 : 0 };
}

/** Google Gemini via REST, with a model fallback chain and quota-aware pacing. */
export class GeminiProvider implements LlmProvider {
  name = "gemini";
  embedDim = 768;
  private key = () => process.env.GEMINI_API_KEY ?? "";
  private embedModel = () => process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
  /** GEMINI_MODEL may be a comma-separated fallback list. */
  private models = () =>
    (process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite,gemini-flash-lite-latest")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

  async isAvailable(): Promise<boolean> {
    return this.key().length > 0;
  }

  /** Run a generate-style call against the first model that isn't exhausted. */
  private async withModel(build: (model: string) => { url: string; init: RequestInit }): Promise<Response> {
    const tried: string[] = [];
    for (const model of this.models()) {
      if ((cooldown.get(model) ?? 0) > Date.now()) continue;
      await limiterFor(model).take();
      const { url, init } = build(model);
      const { res, exhaustedForMs } = await fetchRetry(url, init);
      if (res.ok) return res;
      tried.push(`${model}: ${res.status}`);
      if (exhaustedForMs || res.status === 404) {
        cooldown.set(model, Date.now() + (exhaustedForMs || 3_600_000));
        continue; // fall back to the next model
      }
      throw new Error(`Gemini request failed (${tried.join("; ")})`);
    }
    throw new Error(
      tried.length
        ? `Gemini quota exhausted for all configured models (${tried.join("; ")}). The free tier resets daily — try again later or set GEMINI_MODEL.`
        : "All configured Gemini models are cooling down after hitting their quota — try again shortly.",
    );
  }

  async embed(texts: string[], kind: EmbedKind = "document"): Promise<number[][]> {
    const model = this.embedModel();
    if ((cooldown.get(model) ?? 0) > Date.now()) throw new Error("Gemini embedding quota exhausted — try again later");
    const taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      await limiterFor(model, EMBED_PER_MIN).take(batch.length); // every item counts
      const { res, exhaustedForMs } = await fetchRetry(`${BASE}/models/${model}:batchEmbedContents?key=${this.key()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text: text.slice(0, 8000) }] },
            taskType,
            outputDimensionality: this.embedDim,
          })),
        }),
      });
      if (exhaustedForMs) cooldown.set(model, Date.now() + exhaustedForMs);
      if (!res.ok) throw new Error(`Gemini embed failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { embeddings: { values: number[] }[] };
      for (const e of data.embeddings) out.push(e.values);
    }
    return out;
  }

  async complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
    const res = await this.withModel((model) => ({
      url: `${BASE}/models/${model}:generateContent?key=${this.key()}`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    }));
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  async *stream(system: string, messages: ChatMessage[]): AsyncGenerator<string> {
    const res = await this.withModel((model) => ({
      url: `${BASE}/models/${model}:streamGenerateContent?alt=sse&key=${this.key()}`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
      },
    }));
    if (!res.body) throw new Error("Gemini stream returned no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          const json = JSON.parse(t.slice(5).trim());
          const text = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
          if (text) yield text;
        } catch {
          /* partial JSON across chunks */
        }
      }
    }
  }
}
