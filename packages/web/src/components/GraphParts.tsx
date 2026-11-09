import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Core } from "cytoscape";
import { AlertCircle, Lightbulb, RotateCw, Search } from "lucide-react";
import { useDetail } from "../lib/detail";

/** "What this means": plain-English reading of the numbers in a details panel. */
export function Meaning({ lines }: { lines: string[] }) {
  const { beginner } = useDetail();
  if (!beginner || !lines.length) return null;
  return (
    <div className="mt-3 rounded-md border border-line bg-sunken p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">
        <Lightbulb size={12} aria-hidden /> What this means
      </div>
      <ul className="mt-1.5 space-y-1">
        {lines.map((l) => (
          <li key={l} className="text-[12.5px] leading-relaxed text-fg-2">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GraphError({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-center" role="alert">
      <AlertCircle size={20} className="text-red-600" aria-hidden />
      <p className="text-sm text-fg-2">Couldn’t load the {what}. The API may be restarting.</p>
      <button onClick={onRetry} className="btn-ghost h-9 px-3 py-0 text-xs">
        <RotateCw size={13} aria-hidden /> Try again
      </button>
    </div>
  );
}

/** A banner across the top of the canvas explaining a narrowed view, with a way back. */
export function ViewBanner({ children, onExit, exitLabel }: { children: ReactNode; onExit: () => void; exitLabel: string }) {
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface/95 px-3 py-2 text-[12.5px] text-fg-2 shadow-card backdrop-blur md:max-w-[calc(100%-360px)]">
      <span>{children}</span>
      <button onClick={onExit} className="font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
        {exitLabel}
      </button>
    </div>
  );
}

/** Save the current graph as a PNG on a white background. */
export function exportPng(cy: Core | null, filename: string) {
  if (!cy) return;
  const uri = cy.png({ full: true, scale: 2, bg: "#ffffff", output: "base64uri" }) as string;
  const a = document.createElement("a");
  a.href = uri;
  a.download = filename;
  a.click();
}

/** Labels for every node once the reader zooms in; only hubs at overview zoom. */
export function zoomLabels(cy: Core, threshold = 1.1) {
  let shown = false;
  const update = () => {
    const want = cy.zoom() >= threshold;
    if (want !== shown) {
      shown = want;
      cy.nodes().toggleClass("zl", want);
    }
  };
  cy.on("zoom", update);
  update();
}

/** Small toolbar button shared by the graph views. */
export function ToolButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      {children}
    </button>
  );
}

export interface Crumb {
  label: string;
  onClick?: () => void;
  mono?: boolean;
}

/** "You are here": role › module › file › function, each step clickable where a view exists. */
export function Crumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Location" className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11.5px] text-subtle">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          {c.onClick ? (
            <button
              onClick={c.onClick}
              className={`rounded px-0.5 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg ${c.mono ? "font-mono" : ""}`}
            >
              {c.label}
            </button>
          ) : (
            <span className={`${c.mono ? "font-mono" : ""} ${i === items.length - 1 ? "text-fg" : ""}`}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export interface SearchItem {
  id: string;
  label: string;
  sub?: string;
  kind: string;
}

/** Fuzzy score: every query character in order; bonuses for a match at the start of the name and for runs. */
function fuzzy(q: string, label: string): number {
  const name = label.slice(label.lastIndexOf("/") + 1).toLowerCase();
  const full = label.toLowerCase();
  if (name === q) return 1000;
  if (name.startsWith(q)) return 800 - name.length;
  if (full.includes(q)) return 500 - full.indexOf(q);
  let score = 0;
  let at = -1;
  let run = 0;
  for (const ch of q) {
    const next = full.indexOf(ch, at + 1);
    if (next < 0) return -1;
    run = next === at + 1 ? run + 1 : 0;
    score += 10 + run * 5 - Math.min(9, next - at);
    at = next;
  }
  return score;
}

/** Search box with ranked, keyboard-navigable results. Press "/" anywhere on the view to focus it. */
export function SearchBox({
  items,
  placeholder,
  onPick,
  inputRef,
}: {
  items: SearchItem[];
  placeholder: string;
  onPick: (id: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return items
      .map((it) => ({ it, score: fuzzy(s, it.label) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.it);
  }, [q, items]);
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5 focus-within:border-fg">
        <Search size={13} className="text-subtle" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="graph-search-results"
          aria-label="Search the graph"
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              pick(results[active].id);
            } else if (e.key === "Escape") {
              setQ("");
              inputRef.current?.blur();
            }
          }}
          className="w-44 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
        />
        <kbd className="hidden rounded border border-line bg-surface px-1 font-mono text-[10px] text-subtle sm:inline">/</kbd>
      </div>
      {open && results.length > 0 && (
        <ul id="graph-search-results" role="listbox" className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-lift">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.id)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${i === active ? "bg-sunken" : ""}`}
              >
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-subtle">{r.kind}</span>
                <span className="truncate font-mono text-[12px] text-fg">{r.label.slice(r.label.lastIndexOf("/") + 1)}</span>
                {r.sub && <span className="ml-auto truncate font-mono text-[10.5px] text-subtle">{r.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "/" focuses search, Esc resets the view, F fits the graph — ignored while typing in a field. */
export function useGraphKeys(handlers: { search: () => void; reset: () => void; fit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        handlers.search();
      } else if (e.key === "Escape") handlers.reset();
      else if (e.key === "f" || e.key === "F") handlers.fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
