import {
  layerOf,
  pathKind,
  type Author,
  type FileDetail,
  type ImpactItem,
  type ImpactResponse,
} from "@codeorbit/shared";
import { prisma } from "./db.js";

/** File-level dependency edges: `from` depends on `to` (via an import, or a cross-file call). */
interface DepEdge {
  from: string;
  to: string;
  via: "import" | "call";
  exact: boolean;
}

interface FileGraph {
  edges: DepEdge[];
  clusterOf: Map<string, string | null>;
}

export async function loadFileGraph(jobId: string): Promise<FileGraph> {
  const [nodes, edges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { jobId, nodeType: { in: ["file", "symbol"] } },
      select: { id: true, nodeType: true, label: true, clusterId: true, meta: true },
    }),
    prisma.graphEdge.findMany({
      where: { jobId, edgeType: { in: ["import", "call"] } },
      select: { srcNodeId: true, dstNodeId: true, edgeType: true, resolution: true },
    }),
  ]);
  const fileOfNode = new Map<string, string>();
  const clusterOf = new Map<string, string | null>();
  for (const n of nodes) {
    if (n.nodeType === "file") {
      fileOfNode.set(n.id, n.label);
      clusterOf.set(n.label, n.clusterId);
    } else {
      const f = (n.meta as { file?: string } | null)?.file;
      if (f) fileOfNode.set(n.id, f);
    }
  }
  const out: DepEdge[] = [];
  for (const e of edges) {
    const from = fileOfNode.get(e.srcNodeId);
    const to = fileOfNode.get(e.dstNodeId);
    if (!from || !to || from === to) continue; // external packages and same-file calls carry no impact
    out.push({ from, to, via: e.edgeType === "call" ? "call" : "import", exact: e.resolution !== "name_match" });
  }
  return { edges: out, clusterOf };
}

const MAX_HOPS = 3;
const MAX_IMPACT = 300;

/**
 * Blast radius of changing `target` (after bigyahu-brain's impact analysis): reverse BFS over
 * import + call dependencies, up to 3 hops. Imports are exact; a path through a name-matched
 * call is only "likely".
 */
export async function computeImpact(jobId: string, target: string): Promise<ImpactResponse | null> {
  const file = await prisma.file.findFirst({ where: { jobId, path: target }, select: { id: true } });
  if (!file) return null;
  const { edges, clusterOf } = await loadFileGraph(jobId);

  const dependents = new Map<string, DepEdge[]>();
  for (const e of edges) dependents.set(e.to, [...(dependents.get(e.to) ?? []), e]);

  const seen = new Map<string, ImpactItem>();
  let frontier: { path: string; exact: boolean }[] = [{ path: target, exact: true }];
  for (let hop = 1; hop <= MAX_HOPS && frontier.length; hop++) {
    const next: { path: string; exact: boolean }[] = [];
    for (const cur of frontier) {
      for (const e of dependents.get(cur.path) ?? []) {
        if (e.from === target) continue;
        const exact = cur.exact && e.exact;
        const prev = seen.get(e.from);
        if (prev) {
          // same hop, better evidence → upgrade
          if (prev.hop === hop && exact && prev.certainty === "likely") {
            prev.certainty = "exact";
            prev.via = e.via;
          }
          continue;
        }
        const item: ImpactItem = {
          path: e.from,
          hop,
          via: e.via,
          certainty: exact ? "exact" : "likely",
          kind: pathKind(e.from),
          layer: layerOf(e.from),
        };
        seen.set(e.from, item);
        next.push({ path: e.from, exact });
      }
    }
    frontier = next;
  }

  const all = [...seen.values()].sort(
    (a, b) => a.hop - b.hop || (a.certainty === b.certainty ? 0 : a.certainty === "exact" ? -1 : 1) || a.path.localeCompare(b.path),
  );
  const tests = all.filter((i) => i.kind === "test").map((i) => i.path);

  const modCount = new Map<string, number>();
  for (const i of all) {
    const m = clusterOf.get(i.path);
    if (m) modCount.set(m, (modCount.get(m) ?? 0) + 1);
  }

  const hot = all.length
    ? await prisma.file.count({ where: { jobId, path: { in: all.map((i) => i.path) }, hotspotScore: { gte: 30 } } })
    : 0;

  return {
    target,
    files: all.slice(0, MAX_IMPACT),
    tests,
    modules: [...modCount].map(([id, files]) => ({ id, files })).sort((a, b) => b.files - a.files),
    truncated: all.length > MAX_IMPACT,
    summary: {
      direct: all.filter((i) => i.hop === 1).length,
      transitive: all.filter((i) => i.hop > 1).length,
      tests: tests.length,
      hotspots: hot,
    },
  };
}

/** Everything known about one file: metrics, ownership evidence, neighbours, summary. */
export async function fileDetail(jobId: string, filePath: string): Promise<FileDetail | null> {
  const f = await prisma.file.findFirst({ where: { jobId, path: filePath } });
  if (!f) return null;
  const node = await prisma.graphNode.findFirst({ where: { jobId, nodeType: "file", label: filePath }, select: { id: true } });
  let imports: string[] = [];
  let importedBy: string[] = [];
  if (node) {
    const [outE, inE] = await Promise.all([
      prisma.graphEdge.findMany({ where: { jobId, edgeType: "import", srcNodeId: node.id }, select: { dstNodeId: true } }),
      prisma.graphEdge.findMany({ where: { jobId, edgeType: "import", dstNodeId: node.id }, select: { srcNodeId: true } }),
    ]);
    const ids = [...outE.map((e) => e.dstNodeId), ...inE.map((e) => e.srcNodeId)];
    const labels = new Map(
      (await prisma.graphNode.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })).map((n) => [n.id, n.label]),
    );
    imports = outE.map((e) => labels.get(e.dstNodeId)!).filter(Boolean).sort();
    importedBy = inE.map((e) => labels.get(e.srcNodeId)!).filter(Boolean).sort();
  }
  return {
    path: f.path,
    language: f.language,
    kind: pathKind(f.path),
    layer: layerOf(f.path),
    loc: f.loc,
    complexity: f.complexity,
    churn: f.churn ?? 0,
    fanIn: f.fanIn,
    fanOut: f.fanOut,
    hotspotScore: Math.round(Number(f.hotspotScore) * 10) / 10,
    summary: f.summary,
    owners: Array.isArray(f.owners) ? (f.owners as string[]) : [],
    authors: Array.isArray(f.authors) ? (f.authors as unknown as Author[]) : [],
    lastModified: f.lastModified ? f.lastModified.toISOString() : null,
    imports,
    importedBy,
  };
}

const OWNERSHIP_Q = /\b(who\s+(owns|maintains|wrote|works on)|owners?|maintainers?|authors?|contributors?|blame)\b/i;
const IMPACT_Q = /\b(break|breaks|impact|affect(s|ed)?|blast radius|depends? on|what uses|if i (change|modify|edit|delete|remove))\b/i;

/**
 * GraphRAG context for the chatbot: expand the retrieved files with their dependency-graph
 * neighbours' summaries, and add ownership / impact facts when the question asks for them.
 */
export async function graphContext(jobId: string, question: string, retrievedPaths: string[]): Promise<string> {
  const top = [...new Set(retrievedPaths)].slice(0, 3);
  if (top.length === 0) return "";
  const parts: string[] = [];

  const details = (await Promise.all(top.map((p) => fileDetail(jobId, p)))).filter((d): d is FileDetail => !!d);
  const neighbours = [...new Set(details.flatMap((d) => [...d.imports.slice(0, 3), ...d.importedBy.slice(0, 3)]))]
    .filter((p) => !top.includes(p))
    .slice(0, 8);
  if (neighbours.length) {
    const rows = await prisma.file.findMany({
      where: { jobId, path: { in: neighbours }, summary: { not: null } },
      select: { path: true, summary: true },
    });
    if (rows.length) {
      parts.push(`Related files (dependency graph neighbours):\n${rows.map((r) => `- ${r.path}: ${r.summary}`).join("\n")}`);
    }
  }

  if (OWNERSHIP_Q.test(question)) {
    const lines = details.map((d) => {
      const owners = d.owners.length ? `CODEOWNERS: ${d.owners.join(", ")}` : "no CODEOWNERS entry";
      const authors = d.authors.length ? `top committers: ${d.authors.map((a) => `${a.name} (${a.commits})`).join(", ")}` : "no recent commits";
      const when = d.lastModified ? `, last changed ${d.lastModified.slice(0, 10)}` : "";
      return `- ${d.path}: ${owners}; ${authors}${when}`;
    });
    parts.push(`Ownership evidence (from CODEOWNERS and recent git history):\n${lines.join("\n")}`);
  }

  if (IMPACT_Q.test(question)) {
    const impact = await computeImpact(jobId, top[0]);
    if (impact) {
      const list = impact.files.slice(0, 15).map((i) => `- ${i.path} (hop ${i.hop}, via ${i.via}, ${i.certainty})`).join("\n");
      parts.push(
        `Impact of changing ${impact.target}: ${impact.summary.direct} direct and ${impact.summary.transitive} transitive dependents, ${impact.summary.tests} tests to run.\n${list}`,
      );
    }
  }
  return parts.join("\n\n");
}
