import { createRequire } from "node:module";
import path from "node:path";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);
const WASM_DIR = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
const WTS_DIR = path.dirname(require.resolve("web-tree-sitter/package.json"));

/** File extension → tree-sitter grammar name (the .wasm basename). */
const EXT_GRAMMAR: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".cs": "c_sharp",
  // NOTE: tree-sitter-ruby.wasm is ABI-incompatible with web-tree-sitter 0.20.8
  // (it throws on load), so Ruby is handled by a regex adapter in graph.ts instead.
};

export function grammarFor(ext: string): string | null {
  return EXT_GRAMMAR[ext.toLowerCase()] ?? null;
}

let parser: Parser | null = null;
const languages = new Map<string, Parser.Language>();

async function ensureParser(): Promise<Parser> {
  if (!parser) {
    await Parser.init({ locateFile: (name: string) => path.join(WTS_DIR, name) });
    parser = new Parser();
  }
  return parser;
}

async function loadLanguage(grammar: string): Promise<Parser.Language> {
  let lang = languages.get(grammar);
  if (!lang) {
    lang = await Parser.Language.load(path.join(WASM_DIR, `tree-sitter-${grammar}.wasm`));
    languages.set(grammar, lang);
  }
  return lang;
}

/** Parse `source` with the grammar for `ext`, or null if the ext is unsupported. */
export async function parseSource(ext: string, source: string): Promise<Parser.Tree | null> {
  const grammar = grammarFor(ext);
  if (!grammar) return null;
  const p = await ensureParser();
  p.setLanguage(await loadLanguage(grammar));
  return p.parse(source);
}
