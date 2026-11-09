import type {
  AnalyzeResponse,
  JobStatus,
  TreeResponse,
  GraphDTO,
  GraphViewType,
  OverviewResponse,
  ChatStreamEvent,
  FileDetail,
  ImpactResponse,
  ContributeResponse,
} from "@codeorbit/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Start an analysis. AI enrichment is on by default (the server skips it if no provider is configured). */
export function analyzeRepo(repoUrl: string, llmEnabled = true): Promise<AnalyzeResponse> {
  return fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, llmEnabled }),
  }).then(json<AnalyzeResponse>);
}

export function fetchJob(id: string): Promise<JobStatus> {
  return fetch(`/api/jobs/${id}`).then(json<JobStatus>);
}

export function fetchTree(id: string): Promise<TreeResponse> {
  return fetch(`/api/jobs/${id}/tree`).then(json<TreeResponse>);
}

export interface GraphFilters {
  tests?: boolean;
  /** docs, examples and tooling */
  other?: boolean;
  external?: boolean;
  limit?: number;
}

export function fetchGraph(id: string, type: GraphViewType = "dependency", f: GraphFilters = {}): Promise<GraphDTO> {
  const qs = new URLSearchParams({ type });
  if (f.tests) qs.set("tests", "1");
  if (f.other) qs.set("other", "1");
  if (f.external) qs.set("external", "1");
  if (f.limit) qs.set("limit", String(f.limit));
  return fetch(`/api/jobs/${id}/graph?${qs}`).then(json<GraphDTO>);
}

export function fetchOverview(id: string): Promise<OverviewResponse> {
  return fetch(`/api/jobs/${id}/overview`).then(json<OverviewResponse>);
}

export function fetchFileDetail(id: string, path: string): Promise<FileDetail> {
  return fetch(`/api/jobs/${id}/file?${new URLSearchParams({ path })}`).then(json<FileDetail>);
}

export function fetchContributions(id: string): Promise<ContributeResponse> {
  return fetch(`/api/jobs/${id}/contribute`).then(json<ContributeResponse>);
}

export function fetchImpact(id: string, path: string): Promise<ImpactResponse> {
  return fetch(`/api/jobs/${id}/impact?${new URLSearchParams({ path })}`).then(json<ImpactResponse>);
}

/** POST a chat question and consume the SSE stream (EventSource can't POST). */
export async function streamChat(
  jobId: string,
  question: string,
  sessionId: string | undefined,
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, sessionId }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatStreamEvent);
      } catch {
        /* ignore partial frames */
      }
    }
  }
}
