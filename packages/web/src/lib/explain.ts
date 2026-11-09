/**
 * Plain-English readings of graph numbers, for people new to a codebase. Rule-based (no AI),
 * so every repository gets them. Each function returns short sentences, most important first.
 */
import type { GraphEdgeDTO, GraphNodeDTO, Layer } from "@codeorbit/shared";
import { LAYER_HINT } from "./graphColors";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const article = (l: Layer) => (/^[AEIOU]/.test(l) ? "an" : "a");

export function explainModule(n: GraphNodeDTO, uses: number, usedBy: number): string[] {
  const out: string[] = [];
  if (uses === 0 && usedBy > 0)
    out.push(`A foundation: ${plural(usedBy, "other module")} build on it, and it depends on none of them. Worth understanding early.`);
  else if (usedBy === 0 && uses > 0)
    out.push(`Top of the stack: it uses ${plural(uses, "module")}, but nothing here uses it. This is usually where the app starts or exposes its public API.`);
  else if (uses > 0 && usedBy > 0)
    out.push(`A middle layer: it builds on ${plural(uses, "module")} and ${plural(usedBy, "module")} build on it.`);
  else out.push("Standalone: it has no import links to the other modules shown.");
  if (n.layer) out.push(`Most of its files play ${article(n.layer)} ${n.layer} role (${LAYER_HINT[n.layer]}).`);
  const files = n.fileCount ?? 0;
  if (files >= 25) out.push(`With ${files} files it is one of the big parts of the codebase; use “See its files” to explore it piece by piece.`);
  else if (files <= 3) out.push(`Small (${plural(files, "file")}), so it is quick to read end to end.`);
  return out;
}

export function explainFile(n: GraphNodeDTO): string[] {
  const out: string[] = [];
  const fanIn = n.fanIn ?? 0;
  const fanOut = n.fanOut ?? 0;
  const hot = n.hotspotScore ?? 0;
  if (n.entry) out.push("A recommended starting point for reading this codebase.");
  if (fanIn >= 25) out.push(`One of the most used files: ${fanIn} files import it, so a change here ripples across the project.`);
  else if (fanIn >= 5) out.push(`A shared building block: ${fanIn} files import it, so changes here affect several places.`);
  else if (fanIn >= 1) out.push(`Used by ${plural(fanIn, "file")}, so a change here has a local effect.`);
  else out.push("Nothing else imports it, so it is likely an entry point, a script or a leaf you can change safely.");
  if (fanOut === 0) out.push("It imports nothing else in the project: self-contained and easy to read on its own.");
  else if (fanOut >= 8) out.push(`It pulls in ${fanOut} other files; keep them open while you read it.`);
  if (hot >= 40) out.push("A hotspot: complex and changed often. Expect tricky logic and read it carefully.");
  else if (hot >= 15) out.push("Moderately complex and changed now and then.");
  return out;
}

export function explainFunction(n: GraphNodeDTO, callers: number, callees: number): string[] {
  const out: string[] = [];
  if (callers === 0)
    out.push("Nothing in view calls it, so it is probably an entry point (a route, command or public function) or is called from outside the project.");
  else if (callers >= 5) out.push(`A widely used helper: ${callers} functions call it.`);
  else out.push(`Called by ${plural(callers, "function")}.`);
  if (callees === 0) out.push("It calls no other project functions: a leaf you can read in isolation.");
  else if (callees >= 6) out.push(`An orchestrator: it coordinates ${callees} other functions. Use “Trace” to follow the flow downward.`);
  else out.push(`It calls ${plural(callees, "other function")}.`);
  if (/^__\w+__$/.test(n.label)) out.push("Double underscores mark a special method the language calls for you (like a constructor).");
  else if (n.label.startsWith("_")) out.push("The leading underscore means it is internal by convention: used inside its own file or class, not a public API.");
  if (/^test_?|^it$|^describe$/.test(n.label)) out.push("It is a test.");
  return out;
}

export function explainArrow(e: GraphEdgeDTO): string {
  const files = new Set((e.examples ?? []).map((x) => x.from)).size;
  return `${e.source} depends on ${e.target}: ${plural(e.weight, "import")}${
    files ? ` from ${plural(files, "file")}` : ""
  }. If ${e.target} changes, check ${e.source} too.`;
}

/** A short "how this project is organised" paragraph for the architecture view. */
export function summarizeArchitecture(nodes: GraphNodeDTO[], edges: GraphEdgeDTO[]): string[] {
  if (nodes.length === 0) return [];
  const uses = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  for (const e of edges) {
    uses.set(e.source, (uses.get(e.source) ?? new Set()).add(e.target));
    usedBy.set(e.target, (usedBy.get(e.target) ?? new Set()).add(e.source));
  }
  const roles = new Set(nodes.map((n) => n.layer).filter(Boolean));
  const out = [`The code is split into ${plural(nodes.length, "module")} across ${plural(roles.size, "role")}.`];
  const largest = [...nodes].sort((a, b) => (b.fileCount ?? 0) - (a.fileCount ?? 0))[0];
  if (largest) out.push(`The largest is ${largest.label} (${plural(largest.fileCount ?? 0, "file")}).`);
  const mostUsed = [...nodes].sort((a, b) => (usedBy.get(b.id)?.size ?? 0) - (usedBy.get(a.id)?.size ?? 0))[0];
  const mu = usedBy.get(mostUsed?.id ?? "")?.size ?? 0;
  if (mostUsed && mu >= 2) out.push(`${mostUsed.label} is the most depended-on: ${plural(mu, "module")} use it.`);
  const tops = nodes.filter((n) => !usedBy.get(n.id)?.size && uses.get(n.id)?.size).map((n) => n.label);
  if (tops.length && tops.length <= 3) out.push(`Start at the top: ${tops.join(", ")} ${tops.length === 1 ? "uses" : "use"} the rest and nothing uses ${tops.length === 1 ? "it" : "them"}.`);
  return out;
}
