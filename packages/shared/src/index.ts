import { z } from "zod";

/** Analysis depth achieved for a file (degradation ladder, spec §4.3). */
export type AnalysisTier = "A" | "B" | "C";

/** Job lifecycle stages — mirrors the Prisma JobStatus enum + progress UI. */
export const JOB_STAGES = [
  "queued",
  "cloning",
  "parsing",
  "graphing",
  "metrics",
  "llm",
  "complete",
  "failed",
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Graph vocabulary (language-independent). */
export type GraphNodeType = "file" | "module" | "symbol" | "external_package";
export type GraphEdgeType = "import" | "call" | "contains";
export type GraphViewType = "dependency" | "call" | "architecture";

// ---- Path classification (drives clustering, filtering and scoring) ----

export type PathKind = "source" | "test" | "docs" | "example" | "config";

const TEST_RE =
  /(^|\/)(tests?|__tests__|spec|specs|testing|e2e|fixtures?)(\/|$)|[._-](test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$/i;
const EXAMPLE_RE = /(^|\/)(examples?|samples?|demos?|docs_src|playground|benchmarks?|bench)(\/|$)/i;
const DOCS_RE = /(^|\/)(docs?|documentation|site|website|book|guides?)(\/|$)|\.(md|mdx|rst|txt|adoc)$/i;
const CONFIG_RE =
  /(^|\/)(\.github|\.circleci|\.gitlab|\.vscode|\.devcontainer|\.husky|scripts?|tools?|ci)(\/|$)|^[^/]+\.(json|ya?ml|toml|ini|cfg|lock)$|(^|\/)(dockerfile|makefile|\.[^/]*rc)$/i;

/** Classify a repo-relative path. Order matters: tests and examples win over docs. */
export function pathKind(path: string): PathKind {
  if (TEST_RE.test(path)) return "test";
  if (EXAMPLE_RE.test(path)) return "example";
  if (DOCS_RE.test(path)) return "docs";
  if (CONFIG_RE.test(path)) return "config";
  return "source";
}

/** Kind of an architecture module from its cluster id (e.g. "tests", "(docs)", "fastapi/security"). */
export function moduleKind(clusterId: string): PathKind {
  const bucket = clusterId.match(/^\((\w+)\)$/)?.[1];
  if (bucket) return bucket === "root" ? "source" : (bucket as PathKind);
  return pathKind(`${clusterId}/x`);
}

// ---- Architectural layers (path-pattern heuristic, first match wins) ----

export type Layer =
  | "API" | "Service" | "Data" | "UI" | "Middleware" | "Security" | "External"
  | "Background" | "Utility" | "Config" | "Core" | "Test" | "Docs" | "Examples";

const LAYER_PATTERNS: [Layer, string[]][] = [
  ["API", ["api", "apis", "route", "routes", "router", "routers", "routing", "controller", "controllers", "handler", "handlers", "endpoint", "endpoints", "resolver", "resolvers", "graphql", "rest", "rpc"]],
  ["Middleware", ["middleware", "middlewares", "interceptor", "interceptors", "guard", "guards", "pipe", "pipes", "plugin", "plugins"]],
  ["Security", ["security", "auth", "authn", "authz", "oauth", "oauth2", "permission", "permissions", "crypto", "jwt", "session", "sessions"]],
  ["Service", ["service", "services", "usecase", "usecases", "use-case", "domain", "business", "logic", "core"]],
  ["Data", ["model", "models", "entity", "entities", "schema", "schemas", "db", "database", "migration", "migrations", "repository", "repositories", "repo", "dao", "orm", "store", "stores", "persistence"]],
  ["UI", ["component", "components", "view", "views", "page", "pages", "screen", "screens", "layout", "layouts", "widget", "widgets", "ui", "templates", "static", "styles"]],
  ["External", ["client", "clients", "integration", "integrations", "external", "sdk", "adapter", "adapters", "provider", "providers", "gateway", "gateways"]],
  ["Background", ["worker", "workers", "job", "jobs", "queue", "queues", "cron", "consumer", "consumers", "processor", "processors", "scheduler", "tasks", "background"]],
  ["Utility", ["util", "utils", "helper", "helpers", "lib", "common", "shared", "_compat", "compat", "encoders", "tools"]],
  ["Config", ["config", "configs", "configuration", "settings", "setting", "env"]],
];

/** Architectural layer of a file, by directory/file-name patterns (adapted from Understand-Anything). */
export function layerOf(path: string): Layer {
  const kind = pathKind(path);
  if (kind === "test") return "Test";
  if (kind === "docs") return "Docs";
  if (kind === "example") return "Examples";
  if (kind === "config") return "Config";
  const segs = path.toLowerCase().split("/");
  const stem = (segs.pop() ?? "").replace(/\.[^.]+$/, "");
  for (const [layer, words] of LAYER_PATTERNS) {
    if (segs.some((s) => words.includes(s))) return layer;
  }
  for (const [layer, words] of LAYER_PATTERNS) {
    if (words.includes(stem)) return layer;
  }
  return "Core";
}

/** Layer of an architecture module from its cluster id. */
export function moduleLayer(clusterId: string): Layer {
  const kind = moduleKind(clusterId);
  if (kind !== "source") return layerOf(`${clusterId.replace(/[()]/g, "")}/x.${kind === "docs" ? "md" : "txt"}`);
  return clusterId.startsWith("(") ? "Core" : layerOf(`${clusterId}/__module__`);
}

/** Languages that are prose/data rather than code (excluded from the language mix). */
export const NON_CODE_LANGUAGES = new Set(["Markdown", "JSON", "YAML", "TOML", "XML"]);

// ---- API request/response contracts ----

export const analyzeRequestSchema = z.object({
  // Accepts a full URL, a bare `github.com/owner/repo`, or `owner/repo`.
  // The server's parseRepoUrl does the real parsing and returns a clear error.
  repoUrl: z.string().trim().min(1, "Repository URL is required"),
  llmEnabled: z.boolean().default(true),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export interface AnalyzeResponse {
  jobId: string;
  status: JobStage;
  deduped: boolean;
}

export interface JobStatus {
  id: string;
  status: JobStage;
  stage: string | null;
  progressPct: number;
  error: string | null;
  owner: string;
  name: string;
  /** the exact commit analysed, so the UI can show code as it was (falls back to the branch) */
  commitSha?: string | null;
  defaultBranch?: string | null;
}

/** Shape of a single SSE progress event on /api/jobs/:id/events. */
export interface ProgressEvent {
  stage: JobStage;
  progressPct: number;
  message?: string;
  at: string; // ISO timestamp
}

export interface GraphNodeDTO {
  id: string;
  type: GraphNodeType;
  label: string;
  clusterId: string | null;
  fanIn?: number;
  fanOut?: number;
  hotspotScore?: number;
  fileCount?: number;
  kind?: PathKind;
  /** for symbol nodes: the file that defines it */
  file?: string;
  /** for symbol nodes: definition line */
  line?: number;
  layer?: Layer;
  /** one-line plain-English summary (AI), when available */
  summary?: string | null;
  /** module nodes: the most important files inside */
  keyFiles?: string[];
  /** file nodes: one of the few best places to start reading */
  entry?: boolean;
}

export interface GraphEdgeDTO {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
  /** module edges: the file-level imports behind this arrow (heaviest first, capped) */
  examples?: { from: string; to: string; weight: number }[];
}

export interface GraphDTO {
  type: GraphViewType;
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  truncated: boolean;
}

export interface Citation {
  path: string;
  startLine: number;
  endLine: number;
}

export interface ChatRequest {
  sessionId?: string;
  question: string;
}

// ---- Phase 1: file inventory ----

export interface FileEntry {
  path: string;
  language: string | null;
  loc: number;
  hotspotScore: number;
}

export interface TreeResponse {
  owner: string;
  name: string;
  files: FileEntry[];
  totalFiles: number;
  totalLoc: number;
}

// ---- Phase 3: architecture + metrics overview ----

export interface LanguageMixItem {
  language: string;
  loc: number;
  files: number;
}

export interface ModuleItem {
  clusterId: string;
  label: string;
  fileCount: number;
  summary?: string | null;
}

export interface ReadingItem {
  path: string;
  fanIn: number;
  startScore: number;
  reason: string;
}

export interface HotspotItem {
  path: string;
  hotspotScore: number;
  complexity: number;
  churn: number;
}

export interface OverviewResponse {
  owner: string;
  name: string;
  stars: number | null;
  license: string | null;
  primaryLanguage: string | null;
  defaultBranch: string | null;
  totals: { files: number; loc: number; modules: number };
  languageMix: LanguageMixItem[];
  modules: ModuleItem[];
  readingOrder: ReadingItem[];
  hotspots: HotspotItem[];
  summary: { overview: string; mentalModel: string } | null;
  llmReady: boolean;
  /** this analysis ran with AI enrichment */
  aiEnabled: boolean;
  /** number of retrieval chunks indexed for the chatbot */
  indexedChunks: number;
  layers: { layer: Layer; files: number }[];
  tour: TourStep[];
}

// ---- Phase 4: chat (RAG) ----

export interface ChatMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string;
}

/** SSE events emitted by POST /api/jobs/:id/chat. */
export type ChatStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "token"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done" }
  | { type: "error"; error: string };

// ---- Landing page showcase ("live repo cards") ----

export interface ExampleRepo {
  owner: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  files: number;
  modules: number;
  hotspots: number;
  accent: string; // tailwind-friendly accent token for the card
}

// ---- Guided tour, ownership, file detail, change impact ----

export interface TourStep {
  title: string;
  description: string;
  files: string[];
}

export interface Author {
  name: string;
  commits: number;
}

export interface FileDetail {
  path: string;
  language: string | null;
  kind: PathKind;
  layer: Layer;
  loc: number;
  complexity: number;
  churn: number;
  fanIn: number;
  fanOut: number;
  hotspotScore: number;
  summary: string | null;
  /** explicit CODEOWNERS owners */
  owners: string[];
  /** top git authors over the analysed history */
  authors: Author[];
  lastModified: string | null;
  imports: string[];
  importedBy: string[];
}

export interface ImpactItem {
  path: string;
  /** 1 = direct dependent, 2+ = transitive */
  hop: number;
  via: "import" | "call";
  /** exact = resolved import / same-file call; likely = includes a name-matched call */
  certainty: "exact" | "likely";
  kind: PathKind;
  layer: Layer;
}

export interface ImpactResponse {
  target: string;
  files: ImpactItem[];
  /** test files that (transitively) depend on the target — the ones to run */
  tests: string[];
  modules: { id: string; files: number }[];
  truncated: boolean;
  summary: { direct: number; transitive: number; tests: number; hotspots: number };
}

// ---- Contribute: ranked work items (GitHub issues + tasks found in the code) ----

export type Priority = "high" | "medium" | "low";
export type Difficulty = "easy" | "medium" | "hard";
export type ContributionSource = "github" | "todo" | "untested";

export interface ContributionItem {
  id: string;
  source: ContributionSource;
  title: string;
  url: string | null;
  /** GitHub issue number */
  number?: number;
  priority: Priority;
  difficulty: Difficulty;
  /** 0–100; higher = more important */
  priorityScore: number;
  /** 0–100; higher = harder */
  difficultyScore: number;
  /** type (bug, feature, docs…), maintainer labels, area:<Layer>, status (assigned, stale…) */
  tags: string[];
  /** files the work most likely touches */
  files: string[];
  line?: number;
  /** plain-English reasons behind the priority and difficulty */
  why: string[];
  excerpt?: string;
  labels?: string[];
  comments?: number;
  reactions?: number;
  assigned?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContributeResponse {
  items: ContributionItem[];
  github: { ok: boolean; error?: string; issues: number };
  generatedAt: string;
}
