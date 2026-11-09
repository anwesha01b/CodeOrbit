import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Route, Flame, Code2, Boxes, Layers, Loader2, BookOpen, Sparkles, Network, FileCode2, type LucideIcon } from "lucide-react";
import { useOpenCode } from "./CodeDrawer";
import type { TourStep } from "@codeorbit/shared";
import { fetchOverview, analyzeRepo } from "../lib/api";
import { LANGUAGE_DOT } from "../data/exampleRepos";
import { Markdown } from "./Markdown";

function heat(ratio: number): string {
  if (ratio >= 0.66) return "#f0883e";
  if (ratio >= 0.33) return "#e3a008";
  return "#3fb950";
}

export function OverviewView({ jobId }: { jobId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", jobId],
    queryFn: () => fetchOverview(jobId),
    enabled: !!jobId,
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-muted">
        <Loader2 size={16} className="animate-spin" /> Loading overview…
      </div>
    );
  }
  if (error || !data) return <p className="text-red-600">Couldn’t load the overview.</p>;

  const maxHot = Math.max(1, ...data.hotspots.map((h) => h.hotspotScore));
  const maxLoc = Math.max(1, ...data.languageMix.map((l) => l.loc));

  return (
    <div className="space-y-4">
      {data.summary ? (
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded border border-line bg-sunken text-fg-2">
              <BookOpen size={15} />
            </span>
            <h3 className="text-[14px] font-semibold text-fg">Overview</h3>
          </div>
          <div className="text-sm leading-relaxed text-fg-2"><Markdown text={data.summary.overview} /></div>
          {data.summary.mentalModel && data.summary.mentalModel !== data.summary.overview && (
            <>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                Mental model
              </div>
              <div className="mt-1 text-sm leading-relaxed text-muted"><Markdown text={data.summary.mentalModel} /></div>
            </>
          )}
        </div>
      ) : !data.llmReady ? (
        <div className="card flex items-start gap-2.5 p-4 text-sm text-muted">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-accent-soft" />
          <span>
            Add an LLM key (<span className="font-mono text-fg-2">GEMINI_API_KEY</span>) and
            re-analyze to generate plain-English summaries and enable the chatbot.
          </span>
        </div>
      ) : (
        <GenerateAiCard repo={`${data.owner}/${data.name}`} failed={data.aiEnabled} />
      )}

      {data.tour.length > 0 && <GuidedTour steps={data.tour} />}

      <div className="grid gap-4 lg:grid-cols-2">
      {data.tour.length === 0 && (
      <Panel icon={Route} title="Start here" subtitle="Suggested reading order">
        <ol className="space-y-2.5">
          {data.readingOrder.map((r, i) => (
            <li key={r.path} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 font-mono text-xs text-accent-soft">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="truncate font-mono text-[13px] text-fg">{r.path}</div>
                <div className="text-[11px] text-subtle">{r.reason}</div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      )}

      <Panel icon={Flame} title="Complexity hotspots" subtitle="complexity × churn">
        <ul className="space-y-2.5">
          {data.hotspots.map((h) => (
            <li key={h.path} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-2">
                {h.path}
              </span>
              <span className="shrink-0 text-[10px] text-subtle">
                cx {h.complexity} · churn {h.churn}
              </span>
              <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-black/[0.06]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(h.hotspotScore / maxHot) * 100}%`,
                    background: heat(h.hotspotScore / maxHot),
                  }}
                />
              </span>
            </li>
          ))}
          {data.hotspots.length === 0 && (
            <li className="text-sm text-subtle">No hotspots scored for this repo.</li>
          )}
        </ul>
      </Panel>

      <Panel icon={Code2} title="Language mix">
        <ul className="space-y-2.5">
          {data.languageMix.map((l) => (
            <li key={l.language} className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: LANGUAGE_DOT[l.language] ?? "#6b7280" }}
              />
              <span className="w-24 shrink-0 text-[12.5px] text-fg-2">{l.language}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                <span
                  className="block h-full rounded-full bg-accent/70"
                  style={{ width: `${(l.loc / maxLoc) * 100}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-subtle">
                {l.loc.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel icon={Boxes} title="Modules" subtitle={`${data.totals.modules} subsystems`}>
        <div className="flex flex-wrap gap-2">
          {data.modules.slice(0, 18).map((m) => (
            <span
              key={m.clusterId}
              title={m.summary ?? undefined}
              className="pill border-line bg-sunken font-mono text-fg-2"
            >
              {m.label} <span className="text-subtle">{m.fileCount}</span>
            </span>
          ))}
        </div>
      </Panel>

      <LayerBreakdown layers={data.layers} />
      </div>
    </div>
  );
}

/** Ordered walk through the codebase; one step open at a time. */
function GuidedTour({ steps }: { steps: TourStep[] }) {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const openCode = useOpenCode();
  const [, setParams] = useSearchParams();
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded border border-line bg-sunken text-fg-2">
          <Route size={15} />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-fg">Guided tour</h3>
          <p className="text-[11px] text-subtle">{steps.length} stops, in the order a newcomer should read them</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ol className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {steps.map((s, i) => (
            <li key={i} className="shrink-0">
              <button
                onClick={() => setActive(i)}
                aria-current={i === active}
                className={`flex w-full items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                  i === active ? "bg-accent/15 text-fg" : "text-muted hover:bg-sunken hover:text-fg"
                }`}
              >
                <span className="font-mono text-[11px] text-accent-soft">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="min-w-0 rounded-md border border-line bg-sunken p-4">
          <div className="text-[11px] font-mono text-subtle">
            Step {active + 1} of {steps.length}
          </div>
          <h4 className="mt-1 text-[15px] font-semibold text-fg">{step.title}</h4>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{step.description}</p>
          <ul className="mt-3 space-y-1">
            {step.files.map((f) => (
              <li key={f}>
                <button
                  onClick={() => openCode({ path: f, title: `Tour stop ${active + 1}: ${step.title}` })}
                  className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left font-mono text-[12.5px] text-fg hover:bg-black/[0.04]"
                  title={`Read ${f}`}
                >
                  <FileCode2 size={13} className="shrink-0 text-subtle group-hover:text-fg" aria-hidden />
                  <span className="truncate">{f}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setActive((a) => Math.max(0, a - 1))}
              disabled={active === 0}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-2 hover:border-line-strong disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setActive((a) => Math.min(steps.length - 1, a + 1))}
              disabled={active === steps.length - 1}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-2 hover:border-line-strong disabled:opacity-40"
            >
              Next stop
            </button>
            {step.files[0] && (
              <button
                onClick={() => setParams({ tab: "deps", focus: step.files[0] })}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-fg-2 hover:border-line-strong hover:text-fg"
              >
                <Network size={12} aria-hidden /> Show on the map
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const NON_PRODUCT = new Set(["Test", "Docs", "Examples"]);

/** Product files by architectural layer (path heuristics). */
function LayerBreakdown({ layers }: { layers: { layer: string; files: number }[] }) {
  const product = layers.filter((l) => !NON_PRODUCT.has(l.layer));
  const max = Math.max(1, ...product.map((l) => l.files));
  const other = layers.filter((l) => NON_PRODUCT.has(l.layer));
  return (
    <Panel icon={Layers} title="Architecture layers" subtitle="product files by role">
      <ul className="space-y-2">
        {product.map((l) => (
          <li key={l.layer} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 text-[12.5px] text-fg-2">{l.layer}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
              <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(l.files / max) * 100}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-subtle">{l.files}</span>
          </li>
        ))}
      </ul>
      {other.length > 0 && (
        <p className="mt-3 text-[11px] text-subtle">
          Plus {other.map((l) => `${l.files} ${l.layer.toLowerCase()}`).join(", ")} files.
        </p>
      )}
    </Panel>
  );
}

/** Shown when AI is configured but this analysis has no summaries/index (ran without AI, or enrichment failed). */
export function GenerateAiCard({ repo, failed }: { repo: string; failed: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const { jobId, deduped } = await analyzeRepo(repo, true);
      navigate(deduped ? `/r/${jobId}` : `/analyzing/${jobId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the AI analysis");
      setBusy(false);
    }
  }
  return (
    <div className="card flex flex-wrap items-center gap-4 p-4">
      <Sparkles size={18} className="shrink-0 text-accent-soft" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {failed ? "AI enrichment didn’t complete for this analysis" : "This analysis ran without AI"}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">
          Generate a plain-English overview, file and module summaries, and the index the “Ask the repo” chatbot needs.
        </p>
        {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
      </div>
      <button onClick={generate} disabled={busy} className="btn-primary h-9 py-0 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {failed ? "Retry AI summaries" : "Generate AI summaries"}
      </button>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded border border-line bg-sunken text-fg-2">
          <Icon size={15} />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
          {subtitle && <p className="text-[11px] text-subtle">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
