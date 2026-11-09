/**
 * Language concepts a newcomer may not know, detected in a piece of code and explained in one
 * sentence each (after Understand-Anything's inline "language concepts"). Pure pattern matching.
 */
export interface Concept {
  name: string;
  explain: string;
  count: number;
}

type Rule = [name: string, pattern: RegExp, explain: string];

const PY: Rule[] = [
  ["Decorator", /^\s*@[\w.]+/gm, "A line starting with @ wraps the function below it to add behaviour, such as routing, caching or validation."],
  ["async / await", /\b(async\s+def|await)\b/g, "Asynchronous code: it can pause while waiting (for a network call, say) and let other work run meanwhile."],
  ["Generator (yield)", /\byield\b/g, "A function with yield produces values one at a time instead of building the whole list at once."],
  ["Context manager (with)", /^\s*(async\s+)?with\s+.+:/gm, "with … sets something up and guarantees it is cleaned up afterwards, like closing a file."],
  ["Type hints", /\)\s*->\s*[\w[\]., |]+:|:\s*(int|str|bool|float|list|dict|Optional|Union|Any|Callable|Sequence)\b/g, "Annotations like name: str or -> int say what types are expected; Python does not enforce them at runtime."],
  ["Class inheritance", /^\s*class\s+\w+\s*\([^)]+\)\s*:/gm, "class A(B) means A extends B: it gets B’s behaviour and can override parts of it."],
  ["Comprehension", /\[[^\]\n]+\bfor\b[^\]\n]+\bin\b[^\]\n]+\]|\{[^}\n]+\bfor\b[^}\n]+\bin\b[^}\n]+\}/g, "[x for x in items] builds a list (or dict/set) in one expression instead of a loop."],
  ["*args / **kwargs", /\*\*?\w*(args|kwargs)\b/g, "*args collects extra positional arguments into a tuple; **kwargs collects extra named arguments into a dict."],
  ["Dunder method", /\bdef\s+__\w+__\s*\(/g, "Methods like __init__ or __call__ are hooks Python calls for you (creating an object, calling it like a function…)."],
  ["Lambda", /\blambda\b[^:\n]*:/g, "lambda x: … is a tiny unnamed function written inline."],
  ["Error handling (try)", /^\s*(try|except\b[^:\n]*|finally)\s*:/gm, "try runs code that might fail; except handles the error; finally always runs afterwards, error or not, to clean up."],
  ["isinstance check", /\bisinstance\(/g, "isinstance(x, T) asks whether x is of type T, so the code can branch on what kind of object it got."],
  ["f-string", /\bf["']/g, "f\"Hello {name}\" puts the value of an expression directly into a string."],
];

const JS: Rule[] = [
  ["Arrow function", /=>/g, "(a, b) => a + b is a short way to write a function."],
  ["async / await", /\b(async|await)\b/g, "await pauses until a Promise (usually a network or file operation) finishes, without blocking everything else."],
  ["Promise", /\b(Promise|\.then\()/g, "A Promise stands for a value that arrives later; .then or await gets it when ready."],
  ["Destructuring", /\b(const|let|var)\s*[{[]/g, "const { a, b } = obj pulls fields out of an object (or items out of an array) into variables."],
  ["Spread / rest", /\.\.\.\w/g, "...items copies or spreads the contents of an array/object, or gathers remaining arguments."],
  ["Optional chaining", /\?\./g, "a?.b reads b only if a exists, instead of crashing on null or undefined."],
  ["Template literal", /`[^`]*\$\{/g, "`Hello ${name}` builds a string with values inserted."],
  ["Class inheritance", /\bclass\s+\w+\s+extends\s+\w+/g, "class A extends B gets B’s behaviour and can override parts of it."],
  ["ES modules", /^\s*(import|export)\s/gm, "import / export share code between files; each file is a module."],
  ["JSX", /<[A-Z]\w*[\s/>]/g, "<Component /> is JSX: HTML-like syntax that describes UI, compiled to function calls."],
];

const TS: Rule[] = [
  ["Generics", /\b\w+<[A-Z]\w*(,\s*[A-Z]\w*)*>/g, "Foo<T> is a generic: code that works for many types, with T filled in where it is used."],
  ["Interface / type", /^\s*(export\s+)?(interface|type)\s+\w+/gm, "interface and type describe the shape of data; they exist only at compile time."],
  ["Type annotation", /:\s*(string|number|boolean|void|unknown|any|never)\b/g, "x: string tells the compiler what type a value has, so mistakes are caught before running."],
];

const GO: Rule[] = [
  ["Goroutine", /\bgo\s+(func|\w+\()/g, "go f() runs f concurrently, like a lightweight thread."],
  ["Channel", /\bchan\b|<-/g, "A channel (chan) passes values safely between goroutines."],
  ["defer", /\bdefer\b/g, "defer schedules a call to run when the surrounding function returns, often to clean up."],
  ["Error return", /if\s+err\s*!=\s*nil/g, "Go returns errors as values; if err != nil checks whether the call failed."],
  ["Method receiver", /^func\s+\(\w+\s+\*?\w+\)/gm, "func (s *Server) Run() defines a method on the Server type."],
  ["Interface", /\binterface\s*\{/g, "An interface lists methods; any type with those methods satisfies it automatically."],
];

const JAVA_CS: Rule[] = [
  ["Annotation / attribute", /^\s*(@\w+|\[\w+(\(.*\))?\])/gm, "@Something (Java) or [Something] (C#) attaches metadata that frameworks read, e.g. to map routes."],
  ["Generics", /\b\w+<[A-Z]\w*(,\s*[A-Z]\w*)*>/g, "List<T> is a generic: one piece of code that works for many types."],
  ["Lambda", /->|=>/g, "x -> x * 2 (Java) or x => x * 2 (C#) is a short inline function."],
  ["Exceptions", /\b(try|catch|throws?)\b/g, "try/catch handles errors that are thrown instead of returned."],
  ["async / await", /\b(async|await)\b/g, "async/await runs slow operations without blocking the thread."],
  ["Interface", /\binterface\s+\w+/g, "An interface is a contract: classes that implement it promise these methods."],
];

const RUBY: Rule[] = [
  ["Block", /\bdo\s*\|[^|]*\||\{\s*\|[^|]*\|/g, "do |x| … end passes a chunk of code to a method, which can call it (like a callback)."],
  ["Symbol", /(?<![:\w]):[a-z_]\w*/g, ":name is a symbol: a lightweight, reusable name often used as a key."],
  ["Module / mixin", /^\s*(module|include|extend)\s+[A-Z]/gm, "A module groups methods; include mixes them into a class."],
  ["attr_accessor", /\battr_(accessor|reader|writer)\b/g, "attr_accessor :name creates getter/setter methods for an attribute."],
];

function rulesFor(path: string): Rule[] {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".py" || ext === ".pyi") return PY;
  if (ext === ".ts" || ext === ".tsx") return [...TS, ...JS];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return JS;
  if (ext === ".go") return GO;
  if (ext === ".java" || ext === ".cs" || ext === ".kt") return JAVA_CS;
  if (ext === ".rb") return RUBY;
  return [];
}

/** Concepts present in `code`, most frequent first (strings and comments may cause rare false hits). */
export function detectConcepts(path: string, code: string, max = 8): Concept[] {
  const found: Concept[] = [];
  for (const [name, re, explain] of rulesFor(path)) {
    const count = code.match(re)?.length ?? 0;
    if (count > 0) found.push({ name, explain, count });
  }
  return found.sort((a, b) => b.count - a.count).slice(0, max);
}
