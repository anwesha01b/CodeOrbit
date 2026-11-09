import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import type { Layer } from "@codeorbit/shared";
import { LAYER_COLOR, LAYER_HINT, LAYER_ORDER } from "../lib/graphColors";
import { useDetail } from "../lib/detail";

function readOpen(key: string, beginner: boolean): boolean {
  try {
    const v = localStorage.getItem(`guide:${key}`);
    return v ? v !== "closed" : beginner;
  } catch {
    return beginner;
  }
}

/**
 * "How to read this" strip shown above every graph: what a shape, an arrow and a colour
 * mean, plus a legend of the architectural roles present in this repo.
 */
export function GraphGuide({
  id,
  steps,
  layers,
  extra,
}: {
  id: string;
  steps: ReactNode[];
  layers: Layer[];
  extra?: ReactNode;
}) {
  const { beginner } = useDetail();
  const [open, setOpen] = useState(() => readOpen(id, beginner));
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(`guide:${id}`, o ? "closed" : "open");
      } catch {
        /* storage unavailable — keep in memory */
      }
      return !o;
    });
  };
  const present = LAYER_ORDER.filter((l) => layers.includes(l));
  return (
    <div className="border-b border-line bg-sunken">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg-2 hover:text-fg"
      >
        <HelpCircle size={13} className="text-accent-soft" />
        How to read this
        <ChevronDown size={13} className={`ml-auto text-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-3 px-3 pb-3 md:grid-cols-[1fr_minmax(0,1.1fr)]">
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-muted">
                <span className="font-mono text-[11px] text-accent-soft">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div>
            {present.length > 0 && (
              <>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-subtle">Colour = role in the system</div>
                <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {present.map((l) => (
                    <li key={l} className="flex items-baseline gap-1.5 text-[11.5px]">
                      <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: LAYER_COLOR[l] }} />
                      <span className="text-fg">{l}</span>
                      <span className="truncate text-subtle" title={LAYER_HINT[l]}>
                        {LAYER_HINT[l]}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {extra && <div className="mt-2">{extra}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Hover card positioned over the graph canvas. */
export function GraphTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-line bg-surface/95 px-2.5 py-2 text-[11.5px] text-fg-2 shadow-lift"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      {tip.content}
    </div>
  );
}
