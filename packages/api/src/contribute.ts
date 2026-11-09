import {
  layerOf,
  pathKind,
  type ContributeResponse,
  type ContributionItem,
  type Difficulty,
  type Priority,
} from "@codeorbit/shared";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { loadFileGraph } from "./insights.js";

// ---------- GitHub issues (cached; unauthenticated GitHub allows 60 requests/hour) ----------

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: ({ name?: string } | string)[];
  comments: number;
  reactions?: { total_count?: number; "+1"?: number };
  assignees?: unknown[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const issueCache = new Map<string, { at: number; issues: GhIssue[]; error?: string }>();

async function fetchOpenIssues(owner: string, name: string): Promise<{ issues: GhIssue[]; error?: string }> {
  const key = `${owner}/${name}`.toLowerCase();
  const hit = issueCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "codeorbit" };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  const issues: GhIssue[] = [];
  let error: string | undefined;
  try {
    for (let page = 1; page <= 2; page++) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${name}/issues?state=open&sort=updated&per_page=100&page=${page}`,
        { headers },
      );
      if (res.status === 403 || res.status === 429) {
        error = env.githubToken
          ? "GitHub rate limit reached — try again in a few minutes."
          : "GitHub rate limit reached. Add a GITHUB_TOKEN to .env for 5,000 requests/hour.";
        break;
      }
      if (res.status === 410) {
        error = "Issues are disabled on this repository.";
        break;
      }
      if (!res.ok) {
        error = `GitHub returned ${res.status} for issues.`;
        break;
      }
      const batch = (await res.json()) as GhIssue[];
      issues.push(...batch.filter((i) => !i.pull_request)); // the issues API also returns PRs
      if (batch.length < 100) break;
    }
  } catch {
    error = "Couldn’t reach GitHub to load issues.";
  }
  const entry = { at: Date.now(), issues, error };
  // don't pin a failure for the whole TTL
  if (!error || issues.length) issueCache.set(key, entry);
  return entry;
}

// ---------- signals ----------

const norm = (s: string) => s.toLowerCase().trim();
const has = (labels: string[], ...needles: string[]) => labels.some((l) => needles.some((n) => l.includes(n)));
const titleHas = (t: string, re: RegExp) => re.test(t.toLowerCase());
const log2 = (x: number) => Math.log2(1 + Math.max(0, x));
const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

function bucketPriority(score: number): Priority {
  return score >= 48 ? "high" : score >= 25 ? "medium" : "low";
}
function bucketDifficulty(score: number): Difficulty {
  return score < 30 ? "easy" : score < 60 ? "medium" : "hard";
}

/** Work type from maintainer labels first, then the title wording. */
function issueTypes(labels: string[], title: string): string[] {
  const t: string[] = [];
  if (has(labels, "security", "vulnerab", "cve")) t.push("security");
  if (has(labels, "bug", "defect", "regression", "crash") || titleHas(title, /\b(bug|error|fails?|failing|crash|broken|exception|doesn'?t work|not working|incorrect|wrong)\b/))
    t.push("bug");
  if (has(labels, "perf", "performance", "slow") || titleHas(title, /\b(slow|performance|memory leak|latency)\b/)) t.push("performance");
  if (has(labels, "doc") || titleHas(title, /\b(docs?|documentation|typo|readme|docstring)\b/)) t.push("docs");
  if (has(labels, "test") || titleHas(title, /\b(tests?|coverage)\b/)) t.push("tests");
  if (has(labels, "refactor", "cleanup", "tech debt", "chore", "maintenance")) t.push("refactor");
  if (has(labels, "enhancement", "feature", "proposal", "improvement") || titleHas(title, /\b(add|support|allow|feature|option|ability)\b/))
    t.push("feature");
  if (has(labels, "question", "support", "discussion", "help needed")) t.push("question");
  return t.length ? [...new Set(t)] : ["other"];
}

// ---------- mapping an issue to the files it likely touches ----------

const GENERIC_STEMS = new Set(["index", "main", "__init__", "utils", "util", "base", "core", "types", "app", "init", "mod", "lib", "common", "test", "tests", "setup", "config", "constants", "models", "helpers"]);

interface RepoIndex {
  sourceFiles: string[];
  byStem: Map<string, string[]>;
  bySymbol: Map<string, Set<string>>;
}

const CODE_EXT = /\.(?:py|pyi|ts|tsx|js|jsx|mjs|go|java|rb|cs|rs|php|kt|swift|c|cc|cpp|h)$/;

/**
 * Only code-shaped evidence: file paths, `backticked` code, and identifiers that cannot be
 * plain English (snake_case, camelCase, dotted.names, calls()). Ordinary words like "command"
 * or "option" would otherwise match a central file on almost every issue.
 */
function codeTokens(text: string): { paths: string[]; idents: string[] } {
  const paths = new Set<string>();
  const idents = new Set<string>();
  for (const m of text.matchAll(/[\w./-]+\.(?:py|pyi|ts|tsx|js|jsx|mjs|go|java|rb|cs|rs|php|kt|swift)\b/g)) paths.add(m[0]);
  const addIdent = (raw: string) => {
    for (const part of raw.split(/[.\s(),:[\]]+/)) {
      const id = part.replace(/^@/, "");
      if (id.length >= 4 && /^[A-Za-z_]\w*$/.test(id)) idents.add(id);
    }
  };
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    if (CODE_EXT.test(m[1])) paths.add(m[1]);
    else addIdent(m[1]);
  }
  for (const m of text.matchAll(/\b[A-Za-z_]\w*(?:_\w+|[a-z][A-Z]\w*|\.\w+|\(\))/g)) addIdent(m[0]);
  return { paths: [...paths], idents: [...idents] };
}

/** `common` = identifiers seen across many issues (e.g. `click.command` in every snippet) — not evidence. */
function likelyFiles(text: string, idx: RepoIndex, common: Set<string>): string[] {
  const score = new Map<string, number>();
  const add = (p: string, s: number) => score.set(p, (score.get(p) ?? 0) + s);
  const tok = codeTokens(text);
  const paths = tok.paths;
  const idents = tok.idents.filter((i) => !common.has(i));
  for (const raw of paths) {
    const tok = raw.replace(/^[./]+/, "");
    const hit = idx.sourceFiles.filter((p) => p === tok || p.endsWith(`/${tok}`));
    if (hit.length && hit.length <= 3) hit.forEach((p) => add(p, 6));
  }
  for (const ident of idents) {
    const stem = ident.toLowerCase();
    if (!GENERIC_STEMS.has(stem)) {
      const files = idx.byStem.get(stem);
      if (files && files.length <= 2) files.forEach((p) => add(p, 3));
    }
    const def = idx.bySymbol.get(ident);
    if (def && def.size <= 2) def.forEach((p) => add(p, 3));
  }
  return [...score]
    .filter(([, s]) => s >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => p);
}

function excerptOf(body: string | null): string | undefined {
  if (!body) return undefined;
  const clean = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? (clean.length > 280 ? `${clean.slice(0, 277)}…` : clean) : undefined;
}

// ---------- main ----------

interface FileFacts {
  fanIn: number;
  complexity: number;
  hotspot: number;
}

export async function buildContributions(jobId: string): Promise<ContributeResponse | null> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { repo: true } });
  if (!job) return null;
  const { owner, name } = job.repo;
  const ref = job.commitSha ?? job.repo.defaultBranch;

  const [files, symbols, todos, gh, graph] = await Promise.all([
    prisma.file.findMany({
      where: { jobId },
      select: { path: true, language: true, fanIn: true, complexity: true, hotspotScore: true },
    }),
    prisma.graphNode.findMany({ where: { jobId, nodeType: "symbol" }, select: { label: true, meta: true } }),
    prisma.codeTodo.findMany({ where: { jobId }, orderBy: [{ path: "asc" }, { line: "asc" }] }),
    fetchOpenIssues(owner, name),
    loadFileGraph(jobId),
  ]);

  const facts = new Map<string, FileFacts>(
    files.map((f) => [f.path, { fanIn: f.fanIn, complexity: f.complexity, hotspot: Number(f.hotspotScore) }]),
  );
  // real code only (py.typed, dotfiles etc. classify as "source" by path)
  const sourceFiles = files.filter((f) => pathKind(f.path) === "source" && CODE_EXT.test(f.path)).map((f) => f.path);
  const byStem = new Map<string, string[]>();
  for (const p of sourceFiles) {
    const stem = (p.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), p]);
  }
  const bySymbol = new Map<string, Set<string>>();
  for (const s of symbols) {
    const f = (s.meta as { file?: string } | null)?.file;
    if (!f || pathKind(f) !== "source") continue;
    const set = bySymbol.get(s.label) ?? new Set<string>();
    set.add(f);
    bySymbol.set(s.label, set);
  }
  const idx: RepoIndex = { sourceFiles, byStem, bySymbol };

  /** Shared "how central / how gnarly is the code it touches" signals. */
  const codeSignals = (paths: string[], why: string[]) => {
    let impact = 0;
    let hardness = 0;
    const top = paths.map((p) => facts.get(p)).filter((f): f is FileFacts => !!f);
    const maxFanIn = Math.max(0, ...top.map((f) => f.fanIn));
    const maxCx = Math.max(0, ...top.map((f) => f.complexity));
    const hot = top.some((f) => f.hotspot >= 30);
    if (maxFanIn > 0) {
      impact += Math.min(12, 3 * log2(maxFanIn));
      if (maxFanIn >= 5) why.push(`touches a file ${maxFanIn} others depend on`);
    }
    if (hot) {
      impact += 5;
      hardness += 5;
      why.push("in a complexity hotspot");
    }
    hardness += Math.min(15, maxCx / 15) + Math.min(8, maxFanIn / 5);
    if (paths.length > 2) hardness += 4;
    return { impact, hardness };
  };

  const items: ContributionItem[] = [];

  // 1. open GitHub issues
  const issueText = (is: GhIssue) => `${is.title}\n${(is.body ?? "").slice(0, 4000)}`;
  const docFreq = new Map<string, number>();
  for (const is of gh.issues) for (const id of new Set(codeTokens(issueText(is)).idents)) docFreq.set(id, (docFreq.get(id) ?? 0) + 1);
  const commonCut = Math.max(3, gh.issues.length * 0.08);
  const common = new Set([...docFreq].filter(([, n]) => n > commonCut).map(([id]) => id));
  for (const is of gh.issues) {
    const labels = is.labels.map((l) => norm(typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
    const types = issueTypes(labels, is.title);
    const paths = likelyFiles(issueText(is), idx, common);
    const reactions = is.reactions?.total_count ?? 0;
    const assigned = (is.assignees?.length ?? 0) > 0;
    const age = daysSince(is.updated_at);
    const whyP: string[] = [];
    const whyD: string[] = [];

    let p = 0;
    if (types.includes("security")) (p += 40), whyP.push("security issue");
    if (types.includes("bug")) (p += 30), whyP.push("bug");
    if (has(labels, "regression")) (p += 10), whyP.push("regression");
    if (types.includes("performance")) p += 20;
    if (types.includes("feature")) p += 15;
    if (types.includes("tests")) p += 12;
    if (types.includes("docs") || types.includes("refactor")) p += 10;
    if (types.includes("question")) p -= 10;
    if (has(labels, "critical", "p0", "urgent", "blocker", "severity: high")) (p += 35), whyP.push("marked critical by maintainers");
    else if (has(labels, "high", "p1", "important")) (p += 25), whyP.push("marked high priority");
    else if (has(labels, "p2", "medium")) p += 10;
    else if (has(labels, "low", "p3", "minor", "nice to have")) (p -= 10), whyP.push("marked low priority");
    if (reactions) {
      p += Math.min(20, 4 * log2(reactions));
      if (reactions >= 3) whyP.push(`${reactions} reactions`);
    }
    if (is.comments) p += Math.min(10, 2 * log2(is.comments));
    if (age < 30) (p += 8), whyP.push("recently active");
    else if (age > 365) (p -= 10), whyP.push("no activity for a year");
    if (has(labels, "help wanted", "contributions welcome", "pr welcome")) (p += 5), whyP.push("maintainers want help");
    const sig = codeSignals(paths, whyP);
    p += sig.impact;

    let d = 30 + sig.hardness;
    if (has(labels, "good first issue", "good-first-issue", "beginner", "easy", "starter", "first-timers")) (d -= 30), whyD.push("labelled beginner-friendly");
    if (has(labels, "hard", "complex", "difficult", "breaking", "needs design", "rfc")) (d += 30), whyD.push("labelled complex");
    if (types.includes("docs")) (d -= 20), whyD.push("documentation change");
    if (titleHas(is.title, /\btypo\b/)) d -= 10;
    if (types.includes("security") || types.includes("performance")) (d += 15), whyD.push("needs careful investigation");
    if (types.includes("feature")) d += 8;
    if (!paths.length) (d += 5), whyD.push("affected code not obvious from the description");
    else whyD.push(`likely touches ${paths.length} file${paths.length > 1 ? "s" : ""}`);
    if ((is.body ?? "").length > 3000 || is.comments > 20) (d += 5), whyD.push("long discussion");

    const tags = [
      ...types,
      ...labels.filter((l) => /good first issue|help wanted|beginner|hacktoberfest/.test(l)),
      ...(paths[0] ? [`area:${layerOf(paths[0])}`] : []),
      ...(assigned ? ["assigned"] : []),
      ...(age > 180 ? ["stale"] : age < 14 ? ["active"] : []),
    ];
    const ps = clamp(p);
    const ds = clamp(d);
    items.push({
      id: `gh-${is.number}`,
      source: "github",
      title: is.title,
      url: is.html_url,
      number: is.number,
      priority: bucketPriority(ps),
      difficulty: bucketDifficulty(ds),
      priorityScore: ps,
      difficultyScore: ds,
      tags: [...new Set(tags)],
      files: paths,
      why: [...whyP, ...whyD],
      excerpt: excerptOf(is.body),
      labels,
      comments: is.comments,
      reactions,
      assigned,
      createdAt: is.created_at,
      updatedAt: is.updated_at,
    });
  }

  // 2. TODO / FIXME markers left in the code
  for (const t of todos) {
    const tag = t.tag.toUpperCase();
    const text = t.text.toLowerCase();
    const isTest = pathKind(t.path) === "test";
    const types =
      tag === "FIXME" || tag === "BUG" ? ["bug"] : tag === "HACK" || tag === "XXX" ? ["refactor"] : isTest ? ["tests"] : ["todo"];
    const whyP: string[] = [`${tag} left in the code`];
    const whyD: string[] = [];
    let p = tag === "FIXME" || tag === "BUG" ? 35 : tag === "HACK" || tag === "XXX" ? 25 : 15;
    if (/\b(security|race|leak|crash|deadlock|corrupt|unsafe)\b/.test(text)) (p += 15), whyP.push("mentions a correctness risk");
    if (/\bdeprecat/.test(text)) (p += 5), whyP.push("deprecation");
    const sig = codeSignals([t.path], whyP);
    p += sig.impact;
    let d = 25 + sig.hardness;
    if (/\b(refactor|rewrite|redesign|rework|architecture)\b/.test(text)) (d += 15), whyD.push("asks for a redesign");
    if (/\b(doc|docs|docstring|comment|typo|rename)\b/.test(text)) (d -= 15), whyD.push("small, local change");
    whyD.push("exact location known");
    const ps = clamp(p);
    const ds = clamp(d);
    items.push({
      id: `todo-${t.id}`,
      source: "todo",
      title: `${tag}: ${t.text.length > 120 ? `${t.text.slice(0, 117)}…` : t.text}`,
      url: `https://github.com/${owner}/${name}/blob/${ref}/${t.path}#L${t.line}`,
      priority: bucketPriority(ps),
      difficulty: bucketDifficulty(ds),
      priorityScore: ps,
      difficultyScore: ds,
      tags: [...types, "from code", `area:${layerOf(t.path)}`],
      files: [t.path],
      line: t.line,
      why: [...whyP, ...whyD],
    });
  }

  // 3. important product files that no test exercises
  const testedBy = new Set<string>();
  for (const e of graph.edges) if (pathKind(e.from) === "test") testedBy.add(e.to);
  const hasTests = files.some((f) => pathKind(f.path) === "test");
  if (hasTests) {
    const untested = files
      .filter(
        (f) =>
          pathKind(f.path) === "source" &&
          Number(f.hotspotScore) >= 15 &&
          !testedBy.has(f.path) &&
          // package entry files re-export; tests import them by package name, which the graph can't see
          !/(^|\/)(__init__\.py|index\.[jt]sx?|mod\.rs)$/.test(f.path),
      )
      .sort((a, b) => Number(b.hotspotScore) - Number(a.hotspotScore))
      .slice(0, 10);
    for (const f of untested) {
      const whyP = ["no test imports or calls it", `hotspot score ${Math.round(Number(f.hotspotScore))}`];
      const sig = codeSignals([f.path], whyP);
      const ps = clamp(20 + Number(f.hotspotScore) / 4 + sig.impact);
      const ds = clamp(30 + Math.min(30, f.complexity / 8));
      items.push({
        id: `untested-${f.path}`,
        source: "untested",
        title: `Add tests for ${f.path}`,
        url: `https://github.com/${owner}/${name}/blob/${ref}/${f.path}`,
        priority: bucketPriority(ps),
        difficulty: bucketDifficulty(ds),
        priorityScore: ps,
        difficultyScore: ds,
        tags: ["tests", "from analysis", `area:${layerOf(f.path)}`],
        files: [f.path],
        why: [...whyP, `complexity ${f.complexity}`],
      });
    }
  }

  items.sort((a, b) => b.priorityScore - a.priorityScore || a.difficultyScore - b.difficultyScore);
  return {
    items,
    github: { ok: !gh.error, error: gh.error, issues: gh.issues.length },
    generatedAt: new Date().toISOString(),
  };
}
