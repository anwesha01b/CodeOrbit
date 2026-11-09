import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./Logo";

const LINKS = [
  ["Product", "#product"],
  ["Examples", "#examples"],
  ["How it works", "#how"],
  ["Questions", "#faq"],
];

export function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="container-rl flex h-16 items-center justify-between">
        <a href="/" aria-label="CodeOrbit home">
          <Wordmark />
        </a>
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-muted md:flex">
          {LINKS.map(([label, href]) => (
            <a key={label} href={href} className="link-draw pb-0.5">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href="#analyze" className="btn-primary hidden h-9 px-3.5 py-0 sm:inline-flex">
            Analyze a repository
          </a>
          <button
            onClick={() => setOpen(true)}
            className="btn-ghost h-9 w-9 p-0 md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
          >
            <Menu size={18} aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-canvas md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="container-rl flex h-16 items-center justify-between border-b border-line">
            <Wordmark />
            <button onClick={() => setOpen(false)} className="btn-ghost h-9 w-9 p-0" aria-label="Close menu">
              <X size={18} aria-hidden />
            </button>
          </div>
          <nav aria-label="Mobile" className="container-rl flex flex-1 flex-col gap-1 pt-6">
            {LINKS.map(([label, href]) => (
              <a key={label} href={href} onClick={() => setOpen(false)} className="border-b border-line py-4 text-2xl font-medium tracking-heading text-fg">
                {label}
              </a>
            ))}
            <a href="#analyze" onClick={() => setOpen(false)} className="btn-primary mt-8 h-12 w-full text-base">
              Analyze a repository
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
