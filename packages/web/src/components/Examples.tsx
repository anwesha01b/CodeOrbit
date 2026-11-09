import { ArrowUpRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { EXAMPLE_REPOS } from "../data/exampleRepos";
import { LANGUAGE_DOT } from "../data/exampleRepos";
import { useAnalyze } from "../lib/useAnalyze";

/** Well-known repositories to open in one click (an existing analysis is reused instantly). */
export function Examples() {
  const { submit } = useAnalyze();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section id="examples" className="border-b border-line bg-canvas-dim py-24 sm:py-32">
      <div className="container-rl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">Examples</p>
            <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-heading sm:text-[44px]">Open-source repositories to try</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Pick one to see a full analysis before you paste your own.</p>
          </div>
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLE_REPOS.map((r) => {
            const slug = `${r.owner}/${r.name}`;
            return (
              <li key={slug}>
                <button
                  onClick={async () => {
                    setBusy(slug);
                    await submit(`github.com/${slug}`);
                    setBusy(null);
                  }}
                  className="card card-link group flex h-full w-full flex-col p-5 text-left"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <span className="font-mono text-[14px] text-fg">
                      <span className="text-subtle">{r.owner}/</span>
                      {r.name}
                    </span>
                    {busy === slug ? (
                      <Loader2 size={16} className="shrink-0 animate-spin text-subtle" aria-hidden />
                    ) : (
                      <ArrowUpRight
                        size={16}
                        className="shrink-0 text-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg"
                        aria-hidden
                      />
                    )}
                  </div>
                  <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{r.description}</p>
                  <span className="mt-5 flex items-center gap-2 text-[13px] text-subtle">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: LANGUAGE_DOT[r.language] ?? "#71717a" }} aria-hidden />
                    {r.language}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
