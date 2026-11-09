import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Check, Loader2, AlertCircle } from "lucide-react";
import type { JobStage, ProgressEvent } from "@codeorbit/shared";
import { Wordmark } from "../components/Logo";
import { fetchJob } from "../lib/api";

const STEPS: { key: JobStage; label: string }[] = [
  { key: "queued", label: "Validated & queued" },
  { key: "cloning", label: "Cloning repository" },
  { key: "parsing", label: "Indexing files" },
  { key: "graphing", label: "Parsing code & building the dependency graph" },
  { key: "metrics", label: "Scoring hotspots & clustering modules" },
  { key: "llm", label: "AI summaries & chatbot index" },
  { key: "complete", label: "Done" },
];

const ORDER: JobStage[] = ["queued", "cloning", "parsing", "graphing", "metrics", "llm", "complete"];

export function Analyzing() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<JobStage>("queued");
  const [pct, setPct] = useState(0);
  const [detail, setDetail] = useState("");
  const [repo, setRepo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const log = useRef<ProgressEvent[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    fetchJob(jobId)
      .then((j) => setRepo(`${j.owner}/${j.name}`))
      .catch(() => undefined);

    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as ProgressEvent;
      setStage(ev.stage);
      setPct(ev.progressPct);
      setDetail(ev.message ?? "");
      log.current = [...log.current, ev];
      force((n) => n + 1);
      if (ev.stage === "complete") {
        es.close();
        setTimeout(() => navigate(`/r/${jobId}`), 700);
      }
      if (ev.stage === "failed") {
        es.close();
        fetchJob(jobId).then((j) => setError(j.error ?? "Analysis failed")).catch(() => setError("Analysis failed"));
      }
    };
    es.addEventListener("error", () => es.close());
    return () => es.close();
  }, [jobId, navigate]);

  const currentIdx = ORDER.indexOf(stage);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line">
        <div className="container-rl flex h-16 items-center">
          <Link to="/" aria-label="CodeOrbit home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="container-rl flex min-h-[70vh] items-center justify-center py-16">
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center">
            <p className="text-sm text-subtle">Analyzing</p>
            <h1 className="mt-1 font-mono text-xl font-semibold text-fg">{repo || "repository…"}</h1>
          </div>

          {error ? (
            <div className="card flex items-start gap-3 p-5">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
              <div>
                <p className="font-medium text-fg">Analysis failed</p>
                <p className="mt-1 text-sm text-muted">{error}</p>
                <Link to="/" className="btn-ghost mt-4 inline-flex">Try another repo</Link>
              </div>
            </div>
          ) : (
            <div className="card p-6">
              <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                <div className="h-full rounded-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <ul className="space-y-3">
                {STEPS.map((s) => {
                  const idx = ORDER.indexOf(s.key);
                  const done = stage === "complete" ? true : idx < currentIdx;
                  const active = idx === currentIdx && stage !== "complete";
                  return (
                    <li key={s.key} className="flex items-center gap-3">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                          done
                            ? "border-live/40 bg-live/15 text-live"
                            : active
                              ? "border-accent/40 bg-accent/15 text-accent-soft"
                              : "border-line text-subtle"
                        }`}
                      >
                        {done ? <Check size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
                      </span>
                      <span className={done || active ? "text-fg" : "text-subtle"}>
                        {s.label}
                        {active && detail && detail !== s.label && (
                          <span className="ml-2 text-[12px] text-subtle">{detail}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
