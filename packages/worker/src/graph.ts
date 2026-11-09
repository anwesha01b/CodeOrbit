import { promises as fs } from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { pathKind } from "@codeorbit/shared";
import { grammarFor } from "./parse/treeSitter.js";
import { analyzeFile, analyzeRuby } from "./parse/analyze.js";
import { resolveImport, type GoContext } from "./parse/resolve.js";

/** Code extensions we have no Tree-sitter adapter for — Tier B generic heuristic. */
const GENERIC_EXTS = new Set([
  ".php", ".rs", ".c", ".cc", ".cpp", ".h", ".hpp", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".dart", ".ex", ".exs", ".pl", ".pm", ".lua", ".r", ".m", ".mm",
]);
const GENERIC_IMPORT_RE =
  /(?:^|\n)[ \t]*(?:import|from|require|require_relative|include|use|using|#include)[ \t]+["'<]?([.@\w/-]+)["'>]?/g;

interface FileRow {
  id: string;
  path: string;
}

export interface GraphResult {
  /** file paths that participate in the import graph */
  fileNodes: Set<string>;
  /** external package names referenced */
  externals: Set<string>;
  /** "src\u0000dst" (file→file) → weight */
  internal: Map<string, number>;
  /** "src\u0000name" (file→external) → weight */
  external: Map<string, number>;
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
  /** complexity proxy per file path */
  complexity: Map<string, number>;
  /** call-graph defs and raw (unresolved) call edges */
  callDefs: { file: string; name: string; line: number }[];
  callRaw: { fromFile: string; from: string | null; to: string }[];
}

const SEP = "\u0000";

/** Parse every supported file, resolve its imports, and accumulate the dependency graph. */
export async function buildDependencyGraph(
  root: string,
  files: FileRow[],
  fileSet: Set<string>,
): Promise<GraphResult> {
  const res: GraphResult = {
    fileNodes: new Set(),
    externals: new Set(),
    internal: new Map(),
    external: new Map(),
    fanIn: new Map(),
    fanOut: new Map(),
    complexity: new Map(),
    callDefs: [],
    callRaw: [],
  };
  const outTargets = new Map<string, Set<string>>();
  const inSources = new Map<string, Set<string>>();
  const goCtx = await detectGoContext(root, fileSet, files);

  const addEdge = (from: string, to: string) => {
    if (to === from) return;
    res.fileNodes.add(from);
    res.fileNodes.add(to);
    bump(res.internal, `${from}${SEP}${to}`);
    addTo(outTargets, from, to);
    addTo(inSources, to, from);
  };

  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase();
    const hasGrammar = !!grammarFor(ext);
    const isRuby = ext === ".rb";
    if (!hasGrammar && !isRuby && !GENERIC_EXTS.has(ext)) continue;

    let source: string;
    try {
      source = await fs.readFile(path.join(root, file.path), "utf8");
    } catch {
      continue;
    }

    if (hasGrammar) {
      let specs: string[];
      try {
        const analysis = await analyzeFile(ext, source);
        specs = analysis.imports;
        res.complexity.set(file.path, analysis.complexity);
        for (const d of analysis.defs) res.callDefs.push({ file: file.path, name: d.name, line: d.line });
        for (const e of analysis.callEdges) res.callRaw.push({ fromFile: file.path, from: e.from, to: e.to });
      } catch {
        continue; // a per-file parse failure never fails the job
      }
      for (const spec of specs) {
        const r = resolveImport(file.path, spec, ext, fileSet, goCtx);
        if (!r) continue;
        if (r.kind === "file") addEdge(file.path, r.path);
        else {
          res.fileNodes.add(file.path);
          res.externals.add(r.name);
          bump(res.external, `${file.path}${SEP}${r.name}`);
        }
      }
    } else if (isRuby) {
      const { imports, complexity } = analyzeRuby(source);
      res.complexity.set(file.path, complexity);
      for (const spec of imports) {
        const r = resolveImport(file.path, spec, ".rb", fileSet, goCtx);
        if (!r) continue;
        if (r.kind === "file") addEdge(file.path, r.path);
        else {
          res.fileNodes.add(file.path);
          res.externals.add(r.name);
          bump(res.external, `${file.path}${SEP}${r.name}`);
        }
      }
    } else {
      // Tier B: regex heuristic, relative imports only (file-level edges, no external noise)
      for (const spec of genericImports(source)) {
        if (!spec.startsWith(".")) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), spec));
        const hit = [base, base + ext, `${base}/index${ext}`].find((c) => fileSet.has(c));
        if (hit) addEdge(file.path, hit);
      }
    }
  }

  for (const [p, set] of outTargets) res.fanOut.set(p, set.size);
  for (const [p, set] of inSources) res.fanIn.set(p, set.size);
  return res;
}

/** Persist graph nodes + edges and write fan-in/out back onto the files. */
export async function persistGraph(
  prisma: PrismaClient,
  jobId: string,
  graph: GraphResult,
  fileIdByPath: Map<string, string>,
): Promise<void> {
  // nodes
  const nodeData = [
    ...[...graph.fileNodes].map((p) => ({
      jobId,
      nodeType: "file",
      refId: fileIdByPath.get(p) ?? null,
      label: p,
    })),
    ...[...graph.externals].map((name) => ({
      jobId,
      nodeType: "external_package",
      refId: null,
      label: name,
    })),
  ];
  if (nodeData.length === 0) return;
  await prisma.graphNode.createMany({ data: nodeData });

  const nodes = await prisma.graphNode.findMany({
    where: { jobId },
    select: { id: true, label: true, nodeType: true },
  });
  const idByKey = new Map<string, string>();
  for (const n of nodes) {
    idByKey.set(n.nodeType === "file" ? n.label : `${SEP}ext${SEP}${n.label}`, n.id);
  }

  const edges: { jobId: string; srcNodeId: string; dstNodeId: string; edgeType: string; weight: number; resolution: string }[] = [];
  for (const [key, weight] of graph.internal) {
    const [src, dst] = key.split(SEP);
    const s = idByKey.get(src);
    const d = idByKey.get(dst);
    if (s && d) edges.push({ jobId, srcNodeId: s, dstNodeId: d, edgeType: "import", weight, resolution: "exact" });
  }
  for (const [key, weight] of graph.external) {
    const [src, name] = key.split(SEP);
    const s = idByKey.get(src);
    const d = idByKey.get(`${SEP}ext${SEP}${name}`);
    if (s && d) edges.push({ jobId, srcNodeId: s, dstNodeId: d, edgeType: "import", weight, resolution: "exact" });
  }
  if (edges.length) await prisma.graphEdge.createMany({ data: edges });
}

const NODE_CAP = 1200;

/** Resolve call sites to definitions and persist a best-effort symbol-level call graph. */
export async function persistCallGraph(
  prisma: PrismaClient,
  jobId: string,
  graph: GraphResult,
  fileIdByPath: Map<string, string>,
): Promise<void> {
  if (graph.callDefs.length === 0) return;

  type D = { file: string; name: string; line: number };
  const symKey = (d: D) => `${d.file}${SEP}${d.name}${SEP}${d.line}`;
  const nameToDef = new Map<string, D>();
  const fileDefByName = new Map<string, Map<string, D>>();
  const defByKey = new Map<string, D>();
  for (const d of graph.callDefs) {
    if (!nameToDef.has(d.name)) nameToDef.set(d.name, d);
    let fm = fileDefByName.get(d.file);
    if (!fm) fileDefByName.set(d.file, (fm = new Map()));
    if (!fm.has(d.name)) fm.set(d.name, d);
    defByKey.set(symKey(d), d);
  }

  const edgeCounts = new Map<string, number>();
  const edgeExact = new Set<string>(); // edge keys with at least one same-file (exact) resolution
  const participating = new Set<string>();
  for (const e of graph.callRaw) {
    if (!e.from) continue; // keep only edges with a known enclosing caller
    const caller = fileDefByName.get(e.fromFile)?.get(e.from);
    if (!caller) continue;
    const local = fileDefByName.get(e.fromFile)?.get(e.to);
    const callee = local ?? nameToDef.get(e.to);
    if (!callee) continue; // unresolved call (external/builtin) — dropped
    const ck = symKey(caller);
    const tk = symKey(callee);
    if (ck === tk) continue;
    participating.add(ck);
    participating.add(tk);
    edgeCounts.set(`${ck}|||${tk}`, (edgeCounts.get(`${ck}|||${tk}`) ?? 0) + 1);
    if (local) edgeExact.add(`${ck}|||${tk}`);
  }
  if (participating.size === 0) return;

  // Keep product-code symbols first, then the most connected ones.
  const degree = new Map<string, number>();
  for (const k of edgeCounts.keys()) {
    const [a, b] = k.split("|||");
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const isSrc = (k: string) => (pathKind(defByKey.get(k)!.file) === "source" ? 1 : 0);
  const keys = [...participating]
    .sort((a, b) => isSrc(b) - isSrc(a) || (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
    .slice(0, NODE_CAP);
  await prisma.graphNode.createMany({
    data: keys.map((k) => {
      const d = defByKey.get(k)!;
      return {
        jobId,
        nodeType: "symbol",
        refId: fileIdByPath.get(d.file) ?? null,
        label: d.name,
        meta: { file: d.file, line: d.line } as Prisma.InputJsonValue,
      };
    }),
  });

  const created = await prisma.graphNode.findMany({
    where: { jobId, nodeType: "symbol" },
    select: { id: true, label: true, meta: true },
  });
  const idByKey = new Map<string, string>();
  for (const n of created) {
    const m = n.meta as { file?: string; line?: number } | null;
    if (m?.file != null && m?.line != null) idByKey.set(`${m.file}${SEP}${n.label}${SEP}${m.line}`, n.id);
  }

  const callEdges: { jobId: string; srcNodeId: string; dstNodeId: string; edgeType: string; weight: number; resolution: string }[] = [];
  for (const [key, weight] of edgeCounts) {
    const [ck, tk] = key.split("|||");
    const s = idByKey.get(ck);
    const d = idByKey.get(tk);
    if (s && d) {
      callEdges.push({ jobId, srcNodeId: s, dstNodeId: d, edgeType: "call", weight, resolution: edgeExact.has(key) ? "exact" : "name_match" });
    }
  }
  if (callEdges.length) await prisma.graphEdge.createMany({ data: callEdges });
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

function genericImports(source: string): string[] {
  const out = new Set<string>();
  GENERIC_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GENERIC_IMPORT_RE.exec(source))) out.add(m[1]);
  return [...out];
}

async function detectGoContext(
  root: string,
  fileSet: Set<string>,
  files: FileRow[],
): Promise<GoContext | undefined> {
  if (!fileSet.has("go.mod")) return undefined;
  let modulePrefix = "";
  try {
    const mod = await fs.readFile(path.join(root, "go.mod"), "utf8");
    modulePrefix = mod.match(/^\s*module\s+(\S+)/m)?.[1] ?? "";
  } catch {
    return undefined;
  }
  if (!modulePrefix) return undefined;

  const dirRep = new Map<string, string>();
  for (const f of files) {
    if (!f.path.endsWith(".go")) continue;
    const dir = path.posix.dirname(f.path);
    const existing = dirRep.get(dir);
    if (!existing || (existing.endsWith("_test.go") && !f.path.endsWith("_test.go"))) {
      dirRep.set(dir, f.path);
    }
  }
  return { modulePrefix, dirRep };
}
