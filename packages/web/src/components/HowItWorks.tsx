import { Check, Loader2 } from "lucide-react";

const STEPS = [
  ["Paste a repository URL", "Any public GitHub repository. No account, no install."],
  ["CodeOrbit reads the code", "It parses imports and calls, scores hotspots and writes plain-English summaries."],
  ["Explore and ask", "Follow the tour, open the graphs, or ask the chatbot about any file."],
];

const FACTS = [
  ["7", "languages parsed: JavaScript, TypeScript, Python, Go, Java, C#, Ruby"],
  ["0", "lines of your code executed — the analysis only reads files"],
  ["6", "views per repository: overview, architecture, imports, calls, files, contribute"],
];

/** Mirrors the real analysis progress screen. */
const STAGES: [string, "done" | "active" | "todo"][] = [
  ["Cloning repository", "done"],
  ["Building file inventory", "done"],
  ["Parsing imports and calls", "done"],
  ["Scoring hotspots and modules", "active"],
  ["Writing summaries", "todo"],
];

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-line py-24 sm:py-32">
      <div className="container-rl grid items-start gap-14 lg:grid-cols-[1fr_440px]">
        <div>
          <p className="eyebrow">How it works</p>
          <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-heading sm:text-[44px]">From a URL to a map in three steps</h2>
          <ol className="mt-10 space-y-7">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="grid grid-cols-[40px_1fr] gap-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong font-mono text-[13px] text-fg">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <dl className="mt-12 grid gap-6 border-t border-line pt-8 sm:grid-cols-3">
            {FACTS.map(([n, label]) => (
              <div key={label}>
                <dt className="font-mono text-[32px] font-medium tracking-heading text-fg">{n}</dt>
                <dd className="mt-1 text-[13.5px] leading-snug text-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card overflow-hidden" role="img" aria-label="Analysis progress for fastapi/fastapi">
          <div className="border-b border-line px-5 py-4">
            <div className="font-mono text-[13px] text-fg">fastapi/fastapi</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div className="shimmer-track h-full w-[72%] rounded-full bg-fg" />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11.5px] text-subtle">
              <span>Scoring hotspots and modules</span>
              <span>72%</span>
            </div>
          </div>
          <ul className="space-y-3.5 px-5 py-5">
            {STAGES.map(([s, state]) => (
              <li key={s} className="flex items-center gap-3 text-[14px]">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                    state === "done"
                      ? "border-emerald-200 bg-accent-wash text-accent"
                      : state === "active"
                        ? "border-line-strong bg-surface text-fg"
                        : "border-line text-faint"
                  }`}
                >
                  {state === "done" ? (
                    <Check size={13} aria-hidden />
                  ) : state === "active" ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-faint" />
                  )}
                </span>
                <span className={state === "todo" ? "text-subtle" : "text-fg"}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
