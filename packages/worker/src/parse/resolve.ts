import path from "node:path";

export type Resolved =
  | { kind: "file"; path: string }
  | { kind: "external"; name: string }
  | null;

export interface GoContext {
  modulePrefix: string;
  /** package directory → a representative .go file in it */
  dirRep: Map<string, string>;
}

const JS_EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const JS_INDEX_CANDIDATES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const JAVA_ROOTS = ["", "src/main/java/", "src/", "app/src/main/java/", "java/"];

/** Resolve an import specifier to a file, an external package, or nothing. */
export function resolveImport(
  importerPath: string,
  spec: string,
  ext: string,
  fileSet: Set<string>,
  goCtx?: GoContext,
): Resolved {
  switch (ext.toLowerCase()) {
    case ".py":
      return resolvePython(importerPath, spec, fileSet);
    case ".java":
      return resolveJava(spec, fileSet);
    case ".go":
      return resolveGo(spec, goCtx);
    case ".rb":
      return resolveRuby(importerPath, spec, fileSet);
    case ".cs":
      return resolveCSharp(spec);
    default:
      return resolveJs(importerPath, spec, fileSet);
  }
}

function resolveJs(importerPath: string, spec: string, fileSet: Set<string>): Resolved {
  if (spec.startsWith(".")) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), spec));
    for (const e of JS_EXT_CANDIDATES) if (fileSet.has(base + e)) return { kind: "file", path: base + e };
    for (const i of JS_INDEX_CANDIDATES) if (fileSet.has(base + i)) return { kind: "file", path: base + i };
    return null;
  }
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  return { kind: "external", name };
}

function resolvePython(importerPath: string, spec: string, fileSet: Set<string>): Resolved {
  const dots = spec.match(/^\.+/)?.[0].length ?? 0;
  if (dots > 0) {
    let dir = path.posix.dirname(importerPath);
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    const rest = spec.slice(dots).split(".").filter(Boolean);
    const base = rest.length ? path.posix.join(dir, ...rest) : dir;
    if (fileSet.has(`${base}.py`)) return { kind: "file", path: `${base}.py` };
    if (fileSet.has(`${base}/__init__.py`)) return { kind: "file", path: `${base}/__init__.py` };
    return null;
  }
  const segs = spec.split(".").filter(Boolean);
  const joined = segs.join("/");
  if (fileSet.has(`${joined}.py`)) return { kind: "file", path: `${joined}.py` };
  if (fileSet.has(`${joined}/__init__.py`)) return { kind: "file", path: `${joined}/__init__.py` };
  return { kind: "external", name: segs[0] ?? spec };
}

function resolveJava(spec: string, fileSet: Set<string>): Resolved {
  const segs = spec.split(".").filter(Boolean);
  const joined = segs.join("/");
  for (const root of JAVA_ROOTS) {
    if (fileSet.has(`${root}${joined}.java`)) return { kind: "file", path: `${root}${joined}.java` };
  }
  const first = segs[0] ?? spec;
  const name = first === "java" || first === "javax" ? first : segs.slice(0, 2).join(".");
  return { kind: "external", name };
}

function resolveGo(spec: string, goCtx?: GoContext): Resolved {
  if (goCtx && goCtx.modulePrefix && spec.startsWith(goCtx.modulePrefix)) {
    const rel = spec.slice(goCtx.modulePrefix.length).replace(/^\//, "");
    const rep = goCtx.dirRep.get(rel);
    if (rep) return { kind: "file", path: rep };
  }
  return { kind: "external", name: spec };
}

function resolveRuby(importerPath: string, spec: string, fileSet: Set<string>): Resolved {
  if (spec.startsWith(".")) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), spec));
    if (fileSet.has(base)) return { kind: "file", path: base };
    if (fileSet.has(`${base}.rb`)) return { kind: "file", path: `${base}.rb` };
    return null;
  }
  return { kind: "external", name: spec.split("/")[0] };
}

function resolveCSharp(spec: string): Resolved {
  const segs = spec.split(".").filter(Boolean);
  return { kind: "external", name: segs.slice(0, Math.min(2, segs.length)).join(".") };
}
