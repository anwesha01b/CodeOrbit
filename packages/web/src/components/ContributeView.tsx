import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  CircleDot,
  ExternalLink,
  FlaskConical,
  Loader2,
  MessageSquare,
  Search,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import type { ContributionItem, ContributionSource, Difficulty, Priority } from "@codeorbit/shared";
import { fetchContributions, fetchImpact } from "../lib/api";
import { timeAgo } from "../lib/time";

const PRIORITIES: Priority[] = ["high", "medium", "low"];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

const PRIORITY_STYLE: Record<Priority, { label: string; cls: string; dot: string }> = {
  high: { label: "High priority", cls: "text-rose-700 border-rose-200 bg-rose-50", dot: "bg-rose-400" },
  medium: { label: "Medium priority", cls: "text-amber-700 border-amber-200 bg-amber-50", dot: "bg-amber-400" },
  low: { label: "Low priority", cls: "text-fg-2 border-line-strong bg-sunken", dot: "bg-faint" },
};
const DIFFICULTY_STYLE: Record<Difficulty, { label: string; bars: number; cls: string }> = {
  easy: { label: "Easy", bars: 1, cls: "text-emerald-700" },
  medium: { label: "Medium", bars: 2, cls: "text-sky-700" },
  hard: { label: "Hard", bars: 3, cls: "text-fuchsia-700" },
};
const SOURCE_LABEL: Record<ContributionSource, string> = {
  github: "GitHub issue",
  todo: "TODO in code",
  untested: "Missing tests",
};

type SourceFilter = "all" | "github" | "code";
type Sort = "best" | "easiest" | "important" | "recent";
const PAGE = 25;

export function ContributeView({ jobId }: { jobId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["contribute", jobId],
    queryFn: () => fetchContributions(jobId),
    enabled: !!jobId,
    staleTime: 5 * 60 * 1000,
  });

  const [source, setSource] = useState<SourceFilter>("all");
  const [cell, setCell] = useState<{ p: Priority; d: Difficulty } | null>(null);
  const [pFilter, setPFilter] = useState<Set<Priority>>(new Set());
  const [dFilter, setDFilter] = useState<Set<Difficulty>>(new Set());
  const [tag, setTag] = useState("");
  const [hideAssigned, setHideAssigned] = useState(true);
  const [sort, setSort] = useState<Sort>("best");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const base = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter(
      (i) =>
        (source === "all" || (source === "github" ? i.source === "github" : i.source !== "github")) &&
        (!hideAssigned || !i.assigned),
    );
  }, [data, source, hideAssigned]);

  const tagOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of base) for (const t of i.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = base.filter(
      (i) =>
        (!cell || (i.priority === cell.p && i.difficulty === cell.d)) &&
        (pFilter.size === 0 || pFilter.has(i.priority)) &&
        (dFilter.size === 0 || dFilter.has(i.difficulty)) &&
        (!tag || i.tags.includes(tag)) &&
        (!needle || i.title.toLowerCase().includes(needle) || i.files.some((f) => f.toLowerCase().includes(needle))),
    );
    const by: Record<Sort, (a: ContributionItem, b: ContributionItem) => number> = {
      best: (a, b) => b.priorityScore - b.difficultyScore * 0.6 - (a.priorityScore - a.difficultyScore * 0.6),
      easiest: (a, b) => a.difficultyScore - b.difficultyScore || b.priorityScore - a.priorityScore,
      important: (a, b) => b.priorityScore - a.priorityScore || a.difficultyScore - b.difficultyScore,
      recent: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    };
    return [...list].sort(by[sort]);
  }, [base, cell, pFilter, dFilter, tag, q, sort]);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-muted">
        <Loader2 size={16} className="animate-spin" /> Finding work you can pick up…
      </div>
    );
  }
  if (error || !data) return <p className="text-red-600">Couldn’t load contribution opportunities.</p>;

  const counts = (p: Priority, d: Difficulty) => base.filter((i) => i.priority === p && i.difficulty === d).length;
  const ghCount = data.items.filter((i) => i.source === "github").length;
  const codeCount = data.items.length - ghCount;
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
    setLimit(PAGE);
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-[15px] font-semibold text-fg">Contribute to this repo</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {ghCount} open GitHub issue{ghCount === 1 ? "" : "s"} and {codeCount} task{codeCount === 1 ? "" : "s"} found in the
              code, ranked by how much they matter and how hard they are. Start with the <span className="text-emerald-700">quick wins</span>.
            </p>
            {data.github.error && (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {data.github.error} Showing tasks found in the code.
              </p>
            )}
          </div>
          <Matrix counts={counts} cell={cell} onPick={(c) => (setCell(c), setLimit(PAGE))} />
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5 focus-within:border-accent/50">
          <Search size={13} className="text-subtle" />
          <input
            value={q}
            onChange={(e) => (setQ(e.target.value), setLimit(PAGE))}
            placeholder="Search titles or files…"
            aria-label="Search work items"
            className="w-44 bg-transparent text-xs text-fg placeholder:text-faint focus:outline-none"
          />
        </div>
        <Seg
          value={source}
          onChange={(v) => (setSource(v), setLimit(PAGE))}
          options={[
            { value: "all", label: "All" },
            { value: "github", label: "GitHub issues" },
            { value: "code", label: "From code" },
          ]}
        />
        <span className="mx-0.5 h-4 w-px bg-line" />
        {PRIORITIES.map((p) => (
          <Chip key={p} on={pFilter.has(p)} onClick={() => toggle(pFilter, p, setPFilter)}>
            <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_STYLE[p].dot}`} /> {p}
          </Chip>
        ))}
        <span className="mx-0.5 h-4 w-px bg-line" />
        {DIFFICULTIES.map((d) => (
          <Chip key={d} on={dFilter.has(d)} onClick={() => toggle(dFilter, d, setDFilter)}>
            <Bars n={DIFFICULTY_STYLE[d].bars} cls={DIFFICULTY_STYLE[d].cls} /> {d}
          </Chip>
        ))}
        <select
          value={tag}
          onChange={(e) => (setTag(e.target.value), setLimit(PAGE))}
          aria-label="Filter by tag"
          className="rounded-md border border-line bg-sunken px-2 py-1 text-xs text-fg focus:outline-none"
        >
          <option value="">All tags</option>
          {tagOptions.map(([t, n]) => (
            <option key={t} value={t}>
              {t} ({n})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={hideAssigned} onChange={(e) => setHideAssigned(e.target.checked)} className="accent-blue-500" />
          Hide assigned
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort"
          className="ml-auto rounded-md border border-line bg-sunken px-2 py-1 text-xs text-fg focus:outline-none"
        >
          <option value="best">Best to start with</option>
          <option value="important">Most important</option>
          <option value="easiest">Easiest first</option>
          <option value="recent">Recently active</option>
        </select>
      </div>

      <div className="flex items-center justify-between px-1 text-[12px] text-subtle">
        <span>
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
          {cell && (
            <>
              {" "}· {cell.p} priority, {cell.d}{" "}
              <button onClick={() => setCell(null)} className="text-accent-soft hover:underline">
                clear
              </button>
            </>
          )}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          Nothing matches these filters.{" "}
          {data.items.length === 0 && "This repo has no open issues and no TODO markers in its code."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.slice(0, limit).map((i) => (
            <ItemCard key={i.id} item={i} jobId={jobId} onTag={(t) => (setTag(t), setLimit(PAGE))} />
          ))}
        </ul>
      )}
      {filtered.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost mx-auto flex h-9 px-4 py-0 text-sm">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </button>
      )}
    </div>
  );
}

/** Priority × difficulty grid; the easy + important corner is where newcomers should start. */
function Matrix({
  counts,
  cell,
  onPick,
}: {
  counts: (p: Priority, d: Difficulty) => number;
  cell: { p: Priority; d: Difficulty } | null;
  onPick: (c: { p: Priority; d: Difficulty } | null) => void;
}) {
  return (
    <div className="text-[11px]">
      <div className="grid grid-cols-[64px_repeat(3,56px)] gap-1">
        <span />
        {DIFFICULTIES.map((d) => (
          <span key={d} className={`text-center ${DIFFICULTY_STYLE[d].cls}`}>
            {DIFFICULTY_STYLE[d].label}
          </span>
        ))}
        {PRIORITIES.map((p) => (
          <div key={p} className="contents">
            <span className="flex items-center gap-1.5 capitalize text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_STYLE[p].dot}`} />
              {p}
            </span>
            {DIFFICULTIES.map((d) => {
              const n = counts(p, d);
              const active = cell?.p === p && cell?.d === d;
              const quick = d === "easy" && p !== "low";
              return (
                <button
                  key={d}
                  disabled={n === 0}
                  onClick={() => onPick(active ? null : { p, d })}
                  aria-pressed={active}
                  aria-label={`${n} items: ${p} priority, ${d}`}
                  className={`h-9 rounded border font-mono text-[13px] transition-colors disabled:cursor-default disabled:opacity-35 ${
                    active
                      ? "border-line-strong bg-black/[0.07] text-fg"
                      : quick && n
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400"
                        : "border-line bg-sunken text-fg-2 hover:border-line-strong"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-right text-[10.5px] text-subtle">
        <span className="text-emerald-700">green</span> = quick wins · click a cell to filter
      </p>
    </div>
  );
}

function ItemCard({ item, jobId, onTag }: { item: ContributionItem; jobId: string; onTag: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const p = PRIORITY_STYLE[item.priority];
  const d = DIFFICULTY_STYLE[item.difficulty];
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${p.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
          {p.label}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5 ${d.cls}`}>
          <Bars n={d.bars} cls={d.cls} /> {d.label}
        </span>
        <span className="flex items-center gap-1 text-subtle">
          {item.source === "github" ? <CircleDot size={12} /> : item.source === "todo" ? <Wrench size={12} /> : <FlaskConical size={12} />}
          {SOURCE_LABEL[item.source]}
          {item.number ? ` #${item.number}` : ""}
        </span>
        {item.updatedAt && <span className="text-subtle">· updated {timeAgo(item.updatedAt)}</span>}
        {item.comments ? (
          <span className="flex items-center gap-0.5 text-subtle">
            · <MessageSquare size={11} /> {item.comments}
          </span>
        ) : null}
        {item.reactions ? (
          <span className="flex items-center gap-0.5 text-subtle">
            · <ThumbsUp size={11} /> {item.reactions}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-medium leading-snug text-fg hover:text-accent-soft"
            >
              {item.title}
            </a>
          ) : (
            <span className="text-[14px] font-medium text-fg">{item.title}</span>
          )}
          {item.files.length > 0 && (
            <div className="mt-1 truncate font-mono text-[11.5px] text-muted" title={item.files.join(", ")}>
              {item.files[0]}
              {item.line ? `:${item.line}` : ""}
              {item.files.length > 1 && <span className="text-subtle"> +{item.files.length - 1} more</span>}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <button
                key={t}
                onClick={() => onTag(t)}
                className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors hover:border-line-strong ${tagTone(t)}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-fg-2 hover:border-line-strong"
        >
          How to start <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && <StartGuide item={item} jobId={jobId} />}
    </li>
  );
}

function StartGuide({ item, jobId }: { item: ContributionItem; jobId: string }) {
  const target = item.files[0];
  const impact = useQuery({
    queryKey: ["impact", jobId, target],
    queryFn: () => fetchImpact(jobId, target!),
    enabled: !!target,
  });
  const tests = impact.data?.tests ?? [];
  return (
    <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-2">
      <div>
        {item.excerpt && <p className="mb-3 text-[12.5px] leading-relaxed text-muted">{item.excerpt}</p>}
        <div className="text-[10px] uppercase tracking-wide text-subtle">Why it’s ranked this way</div>
        <ul className="mt-1 space-y-0.5">
          {item.why.map((w) => (
            <li key={w} className="text-[12px] text-fg-2">
              · {w}
            </li>
          ))}
        </ul>
      </div>
      <ol className="space-y-2.5 text-[12.5px] text-fg-2">
        <li>
          <span className="font-mono text-[11px] text-accent-soft">1</span>{" "}
          {item.files.length ? "Read the code it touches:" : "Read the issue and ask the maintainers which files are involved."}
          {item.files.length > 0 && (
            <ul className="ml-4 mt-1 space-y-0.5">
              {item.files.map((f, i) => (
                <li key={f} className="break-all font-mono text-[11.5px] text-fg">
                  {f}
                  {i === 0 && item.line ? `:${item.line}` : ""}
                </li>
              ))}
            </ul>
          )}
        </li>
        {target && (
          <li>
            <span className="font-mono text-[11px] text-accent-soft">2</span> Run these tests before and after your change:
            {impact.isLoading ? (
              <Loader2 size={12} className="ml-4 mt-1 animate-spin text-subtle" />
            ) : tests.length ? (
              <ul className="ml-4 mt-1 space-y-0.5">
                {tests.slice(0, 6).map((t) => (
                  <li key={t} className="break-all font-mono text-[11.5px] text-emerald-700">
                    {t}
                  </li>
                ))}
                {tests.length > 6 && <li className="text-[11px] text-subtle">+{tests.length - 6} more</li>}
              </ul>
            ) : (
              <p className="ml-4 mt-1 text-[12px] text-subtle">No tests cover this code yet. Adding one is part of a great PR.</p>
            )}
          </li>
        )}
        <li>
          <span className="font-mono text-[11px] text-accent-soft">{target ? 3 : 2}</span>{" "}
          {item.source === "github"
            ? "Comment on the issue that you’re taking it, then open a PR that says “Fixes #" + item.number + "”."
            : "Open a PR describing the fix and link the line it resolves."}
        </li>
        {item.url && (
          <li>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-accent-soft hover:underline"
            >
              Open on GitHub <ExternalLink size={11} />
            </a>
          </li>
        )}
      </ol>
    </div>
  );
}

function tagTone(t: string): string {
  if (t === "good first issue" || t.includes("beginner")) return "border-emerald-200 text-emerald-700";
  if (t === "help wanted") return "border-sky-200 text-sky-700";
  if (t === "bug" || t === "security") return "border-rose-200 text-rose-700";
  if (t.startsWith("area:")) return "border-line text-muted font-mono";
  if (t === "assigned" || t === "stale") return "border-line text-subtle";
  return "border-line text-fg-2";
}

function Bars({ n, cls }: { n: number; cls: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${cls}`} aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-[3px] rounded-sm ${i <= n ? "bg-current" : "bg-black/10"}`} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs capitalize transition-colors ${
        on ? "border-accent/50 bg-accent/15 text-accent-soft" : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex items-center rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${value === o.value ? "bg-black/[0.07] text-fg" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
