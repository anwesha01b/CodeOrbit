import { Wordmark } from "./Logo";

const LINKS: [string, string][] = [
  ["Product", "#product"],
  ["Examples", "#examples"],
  ["How it works", "#how"],
  ["Questions", "#faq"],
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="container-rl flex flex-col gap-8 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-3 text-[14px] leading-relaxed text-muted">Interactive codebase maps for new contributors.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[14px] text-muted">
          {LINKS.map(([label, href]) => (
            <a key={label} href={href} className="link-draw pb-0.5">
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="container-rl flex flex-col justify-between gap-2 border-t border-line py-6 text-[13px] text-subtle sm:flex-row">
        <span>© {new Date().getFullYear()} CodeOrbit</span>
        <span>Public GitHub repositories only</span>
      </div>
    </footer>
  );
}
