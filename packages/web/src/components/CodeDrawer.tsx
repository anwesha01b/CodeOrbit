import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GraduationCap, Loader2, X } from "lucide-react";
import { fetchJob } from "../lib/api";
import { detectConcepts } from "../lib/concepts";
import { useDetail } from "../lib/detail";

interface CodeTarget {
  path: string;
  /** a function's definition line; its body is highlighted and scrolled into view */
  line?: number;
  title?: string;
}

const Ctx = createContext<(t: CodeTarget) => void>(() => undefined);
/** open the code drawer from anywhere inside a result page */
export const useOpenCode = () => useContext(Ctx);

const MAX_LINES = 5000;

export function CodeDrawerProvider({ jobId, children }: { jobId: string; children: ReactNode }) {
  const [target, setTarget] = useState<CodeTarget | null>(null);
  const open = useCallback((t: CodeTarget) => setTarget(t), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {target && <CodeDrawer jobId={jobId} target={target} onClose={() => setTarget(null)} />}
    </Ctx.Provider>
  );
}

/** Lines a definition spans: indentation-based for Python/Ruby, brace-counting elsewhere. */
function definitionRange(lines: string[], start: number, path: string): [number, number] {
  const i0 = start - 1;
  if (i0 < 0 || i0 >= lines.length) return [start, start];
  const indentOf = (s: string) => s.match(/^\s*/)![0].length;
  if (/\.(py|pyi|rb)$/i.test(path)) {
    const base = indentOf(lines[i0]);
    let end = i0;
    for (let i = i0 + 1; i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      if (indentOf(lines[i]) <= base && !/^\s*[)\]}]/.test(lines[i])) break;
      end = i;
    }
    if (/\.rb$/i.test(path) && /^\s*end\b/.test(lines[end + 1] ?? "")) end++;
    return [start, end + 1];
  }
  let depth = 0;
  let opened = false;
  for (let i = i0; i < lines.length && i < i0 + 2000; i++) {
    for (const ch of lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") depth--;
    }
    if (opened && depth <= 0) return [start, i + 1];
  }
  return [start, start];
}

const KEYWORDS =
  /\b(def|class|return|import|from|as|if|elif|else|for|while|in|not|and|or|try|except|finally|raise|with|yield|async|await|lambda|pass|break|continue|function|const|let|var|export|new|this|self|extends|implements|interface|type|public|private|protected|static|func|go|defer|package|struct|switch|case|default|throw|catch|None|True|False|null|undefined|true|false|end|do|module|require)\b/g;

/** Minimal, safe syntax colouring: comments, strings and keywords as React spans (never HTML). */
function Highlighted({ text, path }: { text: string; path: string }) {
  const hash = /\.(py|pyi|rb|sh|ya?ml|toml)$/i.test(path);
  const parts: ReactNode[] = [];
  const re = hash ? /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g : /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushCode = (s: string, key: string) => {
    let k = 0;
    let at = 0;
    KEYWORDS.lastIndex = 0;
    let km: RegExpExecArray | null;
    while ((km = KEYWORDS.exec(s))) {
      if (km.index > at) parts.push(s.slice(at, km.index));
      parts.push(
        <span key={`${key}k${k++}`} className="font-medium text-[#0a5c8a]">
          {km[0]}
        </span>,
      );
      at = km.index + km[0].length;
    }
    if (at < s.length) parts.push(s.slice(at));
  };
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) pushCode(text.slice(last, m.index), `c${n}`);
    parts.push(
      <span key={`t${n++}`} className={m[1] ? "italic text-subtle" : "text-[#0a7d55]"}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) pushCode(text.slice(last), `c${n}`);
  return <>{parts}</>;
}

function CodeDrawer({ jobId, target, onClose }: { jobId: string; target: CodeTarget; onClose: () => void }) {
  const { beginner } = useDetail();
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => fetchJob(jobId), staleTime: Infinity });
  const ref = job.data ? job.data.commitSha ?? job.data.defaultBranch ?? "HEAD" : null;
  const repo = job.data ? `${job.data.owner}/${job.data.name}` : "";
  const code = useQuery({
    queryKey: ["code", repo, ref, target.path],
    enabled: !!ref,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${target.path}`);
      if (!res.ok) throw new Error(res.status === 404 ? "This file is not on GitHub at the analysed commit." : `GitHub returned ${res.status}.`);
      return res.text();
    },
  });

  const lines = useMemo(() => (code.data ?? "").replace(/\r\n/g, "\n").split("\n").slice(0, MAX_LINES), [code.data]);
  const [from, to] = useMemo(
    () => (target.line && lines.length ? definitionRange(lines, target.line, target.path) : [0, 0]),
    [lines, target.line, target.path],
  );
  const concepts = useMemo(() => {
    if (!lines.length) return [];
    const scope = from ? lines.slice(from - 1, to).join("\n") : lines.join("\n");
    return detectConcepts(target.path, scope);
  }, [lines, from, to, target.path]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!from || !scroller.current) return;
    const el = scroller.current.querySelector(`[data-line="${Math.max(1, from - 3)}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [from, lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ghUrl = ref ? `https://github.com/${repo}/blob/${ref}/${target.path}${from ? `#L${from}-L${to}` : ""}` : "#";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Code of ${target.path}`}>
      <button className="absolute inset-0 bg-black/30" aria-label="Close code view" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface shadow-lift">
        <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-subtle">{target.title ?? "Source code"}</div>
            <div className="mt-0.5 break-all font-mono text-[13px] text-fg">
              {target.path}
              {from ? <span className="text-subtle"> · lines {from}–{to}</span> : null}
            </div>
          </div>
          <a href={ghUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost h-8 shrink-0 px-2.5 py-0 text-xs">
            <ExternalLink size={13} aria-hidden /> GitHub
          </a>
          <button onClick={onClose} className="btn-ghost h-8 w-8 shrink-0 p-0" aria-label="Close code view">
            <X size={15} aria-hidden />
          </button>
        </div>

        {beginner && concepts.length > 0 && (
          <details open className="group border-b border-line bg-sunken px-5 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle [&::-webkit-details-marker]:hidden">
              <GraduationCap size={13} aria-hidden /> Concepts in this {from ? "function" : "file"} ({concepts.length})
            </summary>
            <ul className="mt-2 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
              {concepts.map((c) => (
                <li key={c.name} className="text-[12.5px] leading-snug text-fg-2">
                  <span className="font-medium text-fg">{c.name}</span>
                  <span className="text-subtle"> ×{c.count}</span> — {c.explain}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div ref={scroller} className="flex-1 overflow-auto bg-canvas-dim">
          {code.isLoading || job.isLoading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Loading the code from GitHub…
            </div>
          ) : code.error ? (
            <div className="p-6 text-sm text-fg-2">
              {(code.error as Error).message}{" "}
              <a href={ghUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline underline-offset-2">
                Try on GitHub
              </a>
            </div>
          ) : (
            <pre className="min-w-max py-3 font-mono text-[12.5px] leading-[1.6]">
              {lines.map((l, i) => {
                const n = i + 1;
                const inDef = from > 0 && n >= from && n <= to;
                return (
                  <div key={n} data-line={n} className={`flex pr-6 ${inDef ? "bg-accent-wash" : ""}`}>
                    <span
                      className={`sticky left-0 w-14 shrink-0 select-none pr-4 text-right ${inDef ? "bg-accent-wash text-accent" : "bg-canvas-dim text-faint"}`}
                    >
                      {n}
                    </span>
                    <span className="whitespace-pre text-fg-2">
                      <Highlighted text={l} path={target.path} />
                    </span>
                  </div>
                );
              })}
              {(code.data ?? "").split("\n").length > MAX_LINES && (
                <div className="px-14 py-3 text-xs text-subtle">File truncated at {MAX_LINES} lines; open it on GitHub to see the rest.</div>
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
