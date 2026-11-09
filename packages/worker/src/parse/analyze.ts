import type Parser from "web-tree-sitter";
import { parseSource, grammarFor } from "./treeSitter.js";

type Node = Parser.SyntaxNode;

export interface Def {
  name: string;
  line: number;
}
export interface CallEdge {
  from: string | null; // enclosing definition name, or null at top level
  to: string; // called identifier
}
export interface FileAnalysis {
  imports: string[];
  complexity: number;
  defs: Def[];
  callEdges: CallEdge[];
}

const DECISION = new Set([
  "if_statement", "elif_clause", "elsif", "unless",
  "for_statement", "for_in_statement", "enhanced_for_statement", "for_each_statement",
  "while_statement", "do_statement", "until",
  "switch_case", "case_statement", "when", "expression_case", "type_case",
  "communication_case", "switch_section", "case_when",
  "catch_clause", "except_clause", "rescue", "rescue_modifier",
  "conditional_expression", "ternary_expression",
  "if_modifier", "while_modifier", "until_modifier",
  "if", "while", "for", "case", // ruby bare forms
]);

type Collector = (node: Node, out: Set<string>) => void;
const COLLECTORS: Record<string, Collector> = {
  python: collectPython, java: collectJava, go: collectGo, c_sharp: collectCSharp,
};
// Ruby's require AST shape is grammar-version-sensitive; its syntax is regular, so use a regex.
function rubyImports(source: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|\n)[ \t]*(require(?:_relative)?)[ \t(]+['"]([^'"\n]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let spec = m[2];
    if (m[1] === "require_relative" && !spec.startsWith(".")) spec = `./${spec}`;
    out.add(spec);
  }
  return [...out];
}
const CALL_GRAMMARS = new Set(["javascript", "typescript", "tsx", "python"]);

/** Parse a file once: imports, complexity proxy, and (JS/TS/Python) call-graph defs + calls. */
export async function analyzeFile(ext: string, source: string): Promise<FileAnalysis> {
  const tree = await parseSource(ext, source);
  if (!tree) return { imports: [], complexity: 0, defs: [], callEdges: [] };
  const grammar = grammarFor(ext) ?? "";
  const collect = COLLECTORS[grammar] ?? collectJs;
  const py = grammar === "python";
  const doCalls = CALL_GRAMMARS.has(grammar);

  const imports = new Set<string>();
  const defs: Def[] = [];
  const callEdges: CallEdge[] = [];
  let complexity = 1;

  try {
    const stack: { node: Node; enclosing: string | null }[] = [{ node: tree.rootNode, enclosing: null }];
    while (stack.length) {
      const { node, enclosing } = stack.pop()!;

      if (DECISION.has(node.type)) complexity++;
      else if (node.type === "boolean_operator") complexity++;
      else if (node.type === "binary_expression" || node.type === "binary") {
        const t = node.childForFieldName("operator")?.text;
        if (t === "&&" || t === "||" || t === "and" || t === "or") complexity++;
      }
      collect(node, imports);

      let next = enclosing;
      if (doCalls) {
        const defName = definitionName(node, py);
        if (defName) {
          defs.push({ name: defName, line: node.startPosition.row + 1 });
          next = defName;
        }
        const callee = callName(node, py);
        if (callee) callEdges.push({ from: enclosing, to: callee });
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i);
        if (c) stack.push({ node: c, enclosing: next });
      }
    }
  } finally {
    tree.delete();
  }

  return { imports: [...imports].filter(Boolean), complexity, defs, callEdges };
}

/** Regex-based Ruby adapter (tree-sitter-ruby is incompatible with this runtime). */
export function analyzeRuby(source: string): { imports: string[]; complexity: number } {
  const complexity =
    1 + (source.match(/\b(?:if|elsif|unless|while|until|case|when|rescue|for|and|or)\b|&&|\|\|/g)?.length ?? 0);
  return { imports: rubyImports(source), complexity };
}

// ---- call-graph helpers (JS/TS + Python) ----
function definitionName(node: Node, py: boolean): string | null {
  if (py) {
    if (node.type === "function_definition") return node.childForFieldName("name")?.text ?? null;
    return null;
  }
  if (node.type === "function_declaration" || node.type === "method_definition" || node.type === "generator_function_declaration") {
    return node.childForFieldName("name")?.text ?? null;
  }
  if (node.type === "variable_declarator") {
    const val = node.childForFieldName("value");
    if (val && (val.type === "arrow_function" || val.type === "function_expression" || val.type === "function")) {
      return node.childForFieldName("name")?.text ?? null;
    }
  }
  return null;
}

function callName(node: Node, py: boolean): string | null {
  if (py) {
    if (node.type !== "call") return null;
    const fn = node.childForFieldName("function");
    if (!fn) return null;
    if (fn.type === "identifier") return fn.text;
    if (fn.type === "attribute") return fn.childForFieldName("attribute")?.text ?? null;
    return null;
  }
  if (node.type !== "call_expression") return null;
  const fn = node.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "member_expression") return fn.childForFieldName("property")?.text ?? null;
  return null;
}

function stripQuotes(text: string): string {
  if (text.length >= 2 && /^['"`]/.test(text)) return text.slice(1, -1);
  return text;
}
function firstChildOfType(node: Node, types: string[]): Node | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && types.includes(c.type)) return c;
  }
  return null;
}

function collectJs(node: Node, out: Set<string>): void {
  if (node.type === "import_statement" || node.type === "export_statement") {
    const src = node.childForFieldName("source");
    if (src && src.type === "string") out.add(stripQuotes(src.text));
    return;
  }
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    const args = node.childForFieldName("arguments");
    if (!fn || !args) return;
    if (!((fn.type === "identifier" && fn.text === "require") || fn.type === "import")) return;
    const s = firstChildOfType(args, ["string"]);
    if (s) out.add(stripQuotes(s.text));
  }
}
function collectPython(node: Node, out: Set<string>): void {
  if (node.type === "import_statement") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      if (c.type === "dotted_name") out.add(c.text);
      else if (c.type === "aliased_import") {
        const name = c.childForFieldName("name");
        if (name) out.add(name.text);
      }
    }
    return;
  }
  if (node.type === "import_from_statement") {
    const mod = node.childForFieldName("module_name");
    if (mod) out.add(mod.text);
  }
}
function collectJava(node: Node, out: Set<string>): void {
  if (node.type === "import_declaration") {
    const id = firstChildOfType(node, ["scoped_identifier", "identifier"]);
    if (id) out.add(id.text.replace(/\.\*$/, ""));
  }
}
function collectGo(node: Node, out: Set<string>): void {
  if (node.type === "import_spec") {
    const p = node.childForFieldName("path") ?? firstChildOfType(node, ["interpreted_string_literal"]);
    if (p) out.add(stripQuotes(p.text));
  }
}
function collectCSharp(node: Node, out: Set<string>): void {
  if (node.type === "using_directive") {
    const id = firstChildOfType(node, ["qualified_name", "identifier"]);
    if (id) out.add(id.text);
  }
}
