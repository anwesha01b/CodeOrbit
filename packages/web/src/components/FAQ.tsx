import { Plus } from "lucide-react";

const QA = [
  {
    q: "Which repositories can I analyze?",
    a: "Any public GitHub repository up to 500 MB, without signing in. Private repositories are not supported yet.",
  },
  {
    q: "Is my code executed or stored?",
    a: "Never executed: the analysis only reads files. The repository is cloned to a temporary folder and deleted after the job; only the graphs, metrics and summaries are kept.",
  },
  {
    q: "How accurate are the graphs?",
    a: "Imports are resolved exactly. Calls inside a file are exact too; calls across files are matched by name, so the call graph marks those links as likely rather than certain.",
  },
  {
    q: "What if my language isn’t supported?",
    a: "The analysis still finishes. You get the file tree, size and change history, and summaries where an AI provider is configured.",
  },
  {
    q: "How are contribution tasks ranked?",
    a: "Open issues and TODO comments get a priority from labels, reactions, recent activity and how central the code is, and a difficulty from labels and the complexity of the files involved. Each item says why.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-b border-line py-24 sm:py-32">
      <div className="container-rl grid gap-12 lg:grid-cols-[360px_1fr]">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-heading sm:text-[44px]">Questions about CodeOrbit</h2>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {QA.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-medium text-fg transition-colors hover:text-fg-2 [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus size={18} className="shrink-0 text-subtle transition-transform duration-200 group-open:rotate-45" aria-hidden />
              </summary>
              <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
