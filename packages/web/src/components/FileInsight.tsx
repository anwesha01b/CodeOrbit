import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Zap, Users, FlaskConical } from "lucide-react";
import { fetchFileDetail, fetchImpact } from "../lib/api";
import { timeAgo } from "../lib/time";

/**
 * Ownership and blast radius for one file: CODEOWNERS + git authors, and an on-demand
 * impact analysis that reports affected files back to the graph for highlighting.
 */
export function FileInsight({
  jobId,
  path,
  onImpact,
}: {
  jobId: string;
  path: string;
  onImpact: (paths: string[] | null) => void;
}) {
  const [showImpact, setShowImpact] = useState(false);
  const detail = useQuery({ queryKey: ["file", jobId, path], queryFn: () => fetchFileDetail(jobId, path) });
  const impact = useQuery({
    queryKey: ["impact", jobId, path],
    queryFn: () => fetchImpact(jobId, path),
    enabled: showImpact,
  });
  useEffect(() => {
    if (showImpact && impact.data) onImpact(impact.data.files.map((f) => f.path));
    // onImpact is a stable callback from the graph view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImpact, impact.data]);

  const d = detail.data;
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {detail.isLoading ? (
        <Loader2 size={13} className="animate-spin text-subtle" />
      ) : d ? (
        <>
          <div className="flex flex-wrap gap-1.5 text-[10.5px]">
            <span className="rounded border border-line bg-sunken px-1.5 py-0.5 text-fg-2">{d.layer} layer</span>
            {d.lastModified && (
              <span className="rounded border border-line bg-sunken px-1.5 py-0.5 text-muted">
                changed {timeAgo(d.lastModified)}
              </span>
            )}
          </div>
          {d.summary && <p className="text-[11.5px] leading-relaxed text-fg-2">{d.summary}</p>}
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-subtle">
              <Users size={11} /> Ownership
            </div>
            {d.owners.length > 0 && (
              <div className="mb-1 font-mono text-[11px] text-fg">{d.owners.join(", ")}</div>
            )}
            {d.authors.length > 0 ? (
              <ul className="space-y-0.5">
                {d.authors.slice(0, 3).map((a) => (
                  <li key={a.name} className="flex justify-between text-[11px] text-muted">
                    <span className="truncate">{a.name}</span>
                    <span className="font-mono text-subtle">{a.commits}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-subtle">
                {d.owners.length ? "No commits in the analysed history." : "No CODEOWNERS entry or recent commits."}
              </p>
            )}
          </div>
        </>
      ) : null}

      {!showImpact ? (
        <button
          onClick={() => setShowImpact(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg hover:border-line-strong"
        >
          <Zap size={12} /> Show impact of changing this file
        </button>
      ) : impact.isLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Loader2 size={12} className="animate-spin" /> Tracing dependents…
        </div>
      ) : impact.data ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-subtle">
            <span className="flex items-center gap-1">
              <Zap size={11} /> Impact
            </span>
            <button
              onClick={() => {
                setShowImpact(false);
                onImpact(null);
              }}
              className="normal-case tracking-normal text-subtle hover:text-fg"
            >
              clear
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              ["direct", impact.data.summary.direct],
              ["transitive", impact.data.summary.transitive],
              ["tests", impact.data.summary.tests],
            ].map(([l, v]) => (
              <div key={l} className="rounded border border-line bg-sunken py-1">
                <div className="font-mono text-sm font-semibold text-fg">{v}</div>
                <div className="text-[9px] uppercase text-subtle">{l}</div>
              </div>
            ))}
          </div>
          {impact.data.files.length === 0 ? (
            <p className="mt-2 text-[11px] text-subtle">Nothing in the repo depends on this file.</p>
          ) : (
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
              {impact.data.files
                .filter((f) => f.kind !== "test")
                .slice(0, 30)
                .map((f) => (
                  <li key={f.path} className="flex items-center gap-1.5 font-mono text-[10.5px]">
                    <span className="w-6 shrink-0 text-subtle">h{f.hop}</span>
                    <span className={`truncate ${f.certainty === "exact" ? "text-fg-2" : "text-subtle"}`} title={f.path}>
                      {f.path}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {impact.data.tests.length > 0 && (
            <div className="mt-2">
              <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-subtle">
                <FlaskConical size={11} /> Tests to run
              </div>
              <ul className="max-h-24 space-y-0.5 overflow-y-auto">
                {impact.data.tests.slice(0, 20).map((t) => (
                  <li key={t} className="truncate font-mono text-[10.5px] text-emerald-700" title={t}>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-[10px] text-subtle">Up to 3 hops via imports and calls. Dimmed = name-matched call, likely.</p>
        </div>
      ) : (
        <p className="text-[11px] text-red-600">Couldn’t compute impact.</p>
      )}
    </div>
  );
}
