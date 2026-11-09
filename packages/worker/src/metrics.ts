import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { Prisma, type PrismaClient } from "@prisma/client";
import { pathKind } from "@codeorbit/shared";
import type { GraphResult } from "./graph.js";
import { grammarFor } from "./parse/treeSitter.js";

interface FileRow {
  id: string;
  path: string;
}

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

/** Wrapper dirs whose child names the real package (src/requests → "src/requests"). */
const WRAPPERS = new Set(["src", "lib", "app", "source", "pkg", "internal", "cmd"]);
/** Monorepo roots: each child is its own package. */
const MONOREPO = new Set(["packages", "apps", "services", "modules", "crates", "libs"]);
/** Filenames (sans extension) that signal an entry point. */
const ENTRY = new Set(["index", "main", "app", "server", "cli", "__main__", "__init__", "mod"]);

/**
 * Architecture module for a file. Source code is split one level inside its package
 * (fastapi/security, lib/core); tests, docs, examples and tooling collapse into one
 * module each so they never swamp the real architecture.
 */
export function moduleOf(filePath: string): string {
  const parts = filePath.split("/");
  const kind = pathKind(filePath);
  if (kind !== "source") return parts.length === 1 ? `(${kind})` : parts[0];
  if (parts.length === 1) return "(root)";
  if (MONOREPO.has(parts[0].toLowerCase()) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  const base = WRAPPERS.has(parts[0].toLowerCase()) && parts.length > 2 ? 1 : 0;
  const depth = parts.length > base + 2 ? base + 2 : base + 1;
  return parts.slice(0, depth).join("/");
}

function startScoreOf(filePath: string, fanIn: number): number {
  const base = (filePath.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
  const depth = filePath.split("/").length - 1;
  let score = fanIn * 3;
  if (ENTRY.has(base)) score += base === "__init__" ? 4 : 12;
  score += Math.max(0, 4 - depth);
  // Onboarding starts in the product code, not its tests or docs.
  return pathKind(filePath) === "source" ? score : score * 0.15;
}

interface History {
  churn: Map<string, number>;
  /** path → author name → commit count */
  authors: Map<string, Map<string, number>>;
  lastModified: Map<string, string>;
}

/**
 * One bounded `git log` pass gives churn, authorship and last-modified per file (ownership
 * evidence, after bigyahu-brain's find_owner). In a shallow clone the oldest commit is the
 * graft boundary and lists *every* file as added, so it is dropped.
 */
async function readHistory(root: string, maxCommits: number): Promise<History> {
  const h: History = { churn: new Map(), authors: new Map(), lastModified: new Map() };
  try {
    const git = simpleGit(root);
    const out = await git.raw(["log", "--no-merges", "--pretty=format:@@C@@%an%x09%aI", "--name-only", "-n", String(maxCommits)]);
    const commits = out.split("@@C@@").map((c) => c.trim()).filter(Boolean);
    const shallow = (await git.raw(["rev-parse", "--is-shallow-repository"]).catch(() => "false")).trim() === "true";
    const used = shallow && commits.length > 1 ? commits.slice(0, -1) : commits;
    for (const commit of used) {
      const [header, ...paths] = commit.split("\n");
      const [author = "unknown", date = ""] = header.split("\t");
      for (const line of paths) {
        const p = line.trim();
        if (!p || p.includes("=>")) continue;
        h.churn.set(p, (h.churn.get(p) ?? 0) + 1);
        const a = h.authors.get(p) ?? new Map<string, number>();
        a.set(author, (a.get(author) ?? 0) + 1);
        h.authors.set(p, a);
        if (!h.lastModified.has(p) && date) h.lastModified.set(p, date); // log is newest-first
      }
    }
  } catch {
    // no usable history — churn stays 0 and hotspots fall back to complexity
  }
  return h;
}

interface OwnerRule {
  re: RegExp;
  owners: string[];
}

/** Translate a CODEOWNERS (gitignore-style) pattern into a path regex. */
export function codeownersRegex(pattern: string): RegExp {
  let p = pattern.trim();
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const body = p
    .split("")
    .map((c, i, arr) => {
      if (c === "*") {
        if (arr[i + 1] === "*") return "";
        return arr[i - 1] === "*" ? ".*" : "[^/]*";
      }
      if (c === "?") return "[^/]";
      return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    })
    .join("");
  const prefix = anchored || p.includes("/") ? "^" : "(^|/)";
  // `docs/*` owns direct children only (GitHub semantics); other patterns also cover sub-paths
  const suffix = /(^|\/)\*$/.test(p) ? "$" : "(/|$)";
  return new RegExp(`${prefix}${body}${suffix}`);
}

/** Parse CODEOWNERS from the usual locations; GitHub semantics: the last matching rule wins. */
async function readCodeowners(root: string): Promise<OwnerRule[]> {
  for (const rel of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    try {
      const text = await fs.readFile(path.join(root, rel), "utf8");
      return text
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .map((l) => {
          const [pattern, ...owners] = l.split(/\s+/);
          return { re: codeownersRegex(pattern), owners };
        })
        .filter((r) => r.owners.length > 0);
    } catch {
      /* try next location */
    }
  }
  return [];
}

function ownersFor(filePath: string, rules: OwnerRule[]): string[] {
  let owners: string[] = [];
  for (const r of rules) if (r.re.test(filePath)) owners = r.owners;
  return owners;
}

const logNorm = (x: number, max: number) => (max > 0 ? Math.log1p(x) / Math.log1p(max) : 0);

/**
 * Stage 5 — per-file metrics (complexity, churn, fan-in/out, hotspot, start score, tier),
 * then directory-based module clustering. Returns the module count.
 */
export async function computeMetrics(
  prisma: PrismaClient,
  jobId: string,
  root: string,
  files: FileRow[],
  graph: GraphResult,
  churnCommits: number,
): Promise<number> {
  const history = await readHistory(root, churnCommits);
  const churn = history.churn;
  const ownerRules = await readCodeowners(root);

  let maxComplexity = 0;
  let maxChurn = 0;
  for (const f of files) {
    if (pathKind(f.path) !== "source") continue;
    maxComplexity = Math.max(maxComplexity, graph.complexity.get(f.path) ?? 0);
    maxChurn = Math.max(maxChurn, churn.get(f.path) ?? 0);
  }

  const rows = files.map((f) => {
    const complexity = graph.complexity.get(f.path) ?? 0;
    const ch = churn.get(f.path) ?? 0;
    const fanIn = graph.fanIn.get(f.path) ?? 0;
    const isSource = pathKind(f.path) === "source";
    // log-scaled so scores spread instead of collapsing to 0; only product code is a hotspot
    const hotspot = isSource
      ? Math.round(100 * logNorm(complexity, maxComplexity) * (maxChurn > 0 ? logNorm(ch, maxChurn) : 1) * 10) / 10
      : 0;
    const ext = extOf(f.path);
    const authors = [...(history.authors.get(f.path) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, commits]) => ({ name, commits }));
    const owners = ownersFor(f.path, ownerRules);
    return Prisma.sql`(${f.id}::uuid, ${complexity}::int, ${ch}::int, ${fanIn}::int, ${graph.fanOut.get(f.path) ?? 0}::int,
      ${hotspot}::float8, ${startScoreOf(f.path, fanIn)}::float8, ${grammarFor(ext) || ext === ".rb" ? "A" : "B"}::text,
      ${JSON.stringify(authors)}::jsonb, ${JSON.stringify(owners)}::jsonb, ${history.lastModified.get(f.path) ?? null}::timestamptz)`;
  });

  for (let i = 0; i < rows.length; i += 500) {
    await prisma.$executeRaw`
      UPDATE files AS f SET complexity = v.complexity, churn = v.churn, fan_in = v.fan_in, fan_out = v.fan_out,
        hotspot_score = v.hot, start_score = v.start, tier = v.tier,
        authors = v.authors, owners = v.owners, last_modified = v.modified
      FROM (VALUES ${Prisma.join(rows.slice(i, i + 500))})
        AS v(id, complexity, churn, fan_in, fan_out, hot, start, tier, authors, owners, modified)
      WHERE f.id = v.id`;
  }

  const byModule = new Map<string, string[]>();
  for (const f of files) {
    const key = moduleOf(f.path);
    const list = byModule.get(key) ?? [];
    list.push(f.path);
    byModule.set(key, list);
  }

  await prisma.module.createMany({
    data: [...byModule].map(([key, paths]) => ({ jobId, clusterId: key, label: key, fileCount: paths.length })),
  });

  for (const [key, paths] of byModule) {
    for (let i = 0; i < paths.length; i += 500) {
      await prisma.graphNode.updateMany({
        where: { jobId, nodeType: "file", label: { in: paths.slice(i, i + 500) } },
        data: { clusterId: key },
      });
    }
  }

  return byModule.size;
}
