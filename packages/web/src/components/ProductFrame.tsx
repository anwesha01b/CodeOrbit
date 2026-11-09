import { LayoutGrid, Boxes, Network, GitFork, FolderTree, GitPullRequest } from "lucide-react";
import { Logo } from "./Logo";

/*
 * CodeOrbit's own Architecture view, as it renders for fastapi/fastapi (module names, file
 * counts, links and the summary are from a real analysis). Drawn as one SVG so it scales cleanly.
 */

const LANES = [
  { name: "Middleware", color: "#0891b2", y: 30 },
  { name: "Security", color: "#e11d48", y: 90 },
  { name: "Core", color: "#0284c7", y: 150 },
  { name: "Data", color: "#d97706", y: 210 },
  { name: "Utility", color: "#71717a", y: 270 },
];
const BOX_H = 34;
type Box = { id: string; label: string; files: number; x: number; y: number; w: number; color: string; selected?: boolean };
const BOXES: Box[] = [
  { id: "mw", label: "fastapi/middleware", files: 7, x: 400, y: 30, w: 168, color: "#0891b2" },
  { id: "sec", label: "fastapi/security", files: 7, x: 400, y: 90, w: 168, color: "#e11d48" },
  { id: "root", label: "(root)", files: 4, x: 210, y: 150, w: 120, color: "#0284c7" },
  { id: "core", label: "fastapi", files: 33, x: 400, y: 150, w: 132, color: "#0284c7" },
  { id: "oapi", label: "fastapi/openapi", files: 5, x: 590, y: 150, w: 150, color: "#0284c7" },
  { id: "deps", label: "fastapi/dependencies", files: 3, x: 400, y: 210, w: 186, color: "#d97706", selected: true },
  { id: "compat", label: "fastapi/_compat", files: 3, x: 400, y: 270, w: 160, color: "#71717a" },
];

/** edges: d = path, kind = plain | uses (blue) | usedby (amber) */
const EDGES: { d: string; kind: "plain" | "uses" | "usedby" }[] = [
  { d: "M400 133 L400 107", kind: "plain" },
  { d: "M334 140 C 290 120, 290 40, 316 32", kind: "plain" },
  { d: "M270 150 L334 150", kind: "plain" },
  { d: "M466 150 L515 150", kind: "plain" },
  { d: "M400 193 L400 167", kind: "uses" },
  { d: "M400 227 L400 253", kind: "uses" },
  { d: "M493 206 C 560 196, 560 100, 484 92", kind: "uses" },
  { d: "M560 167 C 545 190, 520 205, 493 210", kind: "usedby" },
];

export function ProductFrame() {
  const tabs: [string, typeof LayoutGrid, boolean][] = [
    ["Overview", LayoutGrid, false],
    ["Architecture", Boxes, true],
    ["Dependencies", Network, false],
    ["Call graph", GitFork, false],
    ["Files", FolderTree, false],
    ["Contribute", GitPullRequest, false],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-frame" aria-label="CodeOrbit architecture view of fastapi/fastapi" role="img">
      {/* app header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <Logo className="h-5 w-5" />
          <span className="font-mono text-[13px] text-fg">fastapi/fastapi</span>
        </div>
        <div className="hidden gap-5 font-mono text-[12px] text-subtle sm:flex">
          <span>
            <span className="text-fg">3,046</span> files
          </span>
          <span>
            <span className="text-fg">407,832</span> lines
          </span>
        </div>
      </div>
      {/* tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3 sm:px-4">
        {tabs.map(([t, Icon, on]) => (
          <span
            key={t}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12.5px] ${
              on ? "border-fg font-medium text-fg" : "border-transparent text-subtle"
            }`}
          >
            <Icon size={13} aria-hidden /> {t}
          </span>
        ))}
      </div>
      {/* body */}
      <div className="grid md:grid-cols-[1fr_272px]">
        <div className="grid-backdrop bg-canvas-dim p-3 sm:p-5">
          <svg viewBox="0 0 680 300" className="h-auto w-full" aria-hidden>
            <defs>
              {(["plain", "uses", "usedby"] as const).map((k) => (
                <marker key={k} id={`arw-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L8 4 L0 8 z" fill={k === "uses" ? "#2563eb" : k === "usedby" ? "#c2410c" : "#a1a1aa"} />
                </marker>
              ))}
            </defs>
            {LANES.map((l) => (
              <g key={l.name}>
                <rect x="0" y={l.y - 28} width="680" height="56" fill={l.color} opacity="0.035" />
                <text x="14" y={l.y + 4} fontSize="12" fontWeight="600" fill={l.color} fontFamily="Geist, system-ui, sans-serif">
                  {l.name}
                </text>
              </g>
            ))}
            {EDGES.map((e, i) => (
              <path
                key={i}
                d={e.d}
                fill="none"
                stroke={e.kind === "uses" ? "#2563eb" : e.kind === "usedby" ? "#c2410c" : "#a1a1aa"}
                strokeWidth={e.kind === "plain" ? 1.3 : 1.8}
                strokeDasharray={e.kind === "plain" ? undefined : "5 4"}
                className={e.kind === "plain" ? undefined : "pulse-line"}
                markerEnd={`url(#arw-${e.kind})`}
              />
            ))}
            {BOXES.map((b) => (
              <g key={b.id}>
                <rect
                  x={b.x - b.w / 2}
                  y={b.y - BOX_H / 2}
                  width={b.w}
                  height={BOX_H}
                  rx="6"
                  fill={b.selected ? "#ecfdf4" : "#ffffff"}
                  stroke={b.selected ? "#18181b" : b.color}
                  strokeWidth={b.selected ? 2 : 1.4}
                />
                <text x={b.x} y={b.y - 1} textAnchor="middle" fontSize="11" fill="#18181b" fontFamily="'Geist Mono', monospace">
                  {b.label}
                </text>
                <text x={b.x} y={b.y + 11} textAnchor="middle" fontSize="9.5" fill="#6b6b73" fontFamily="'Geist Mono', monospace">
                  {b.files} files
                </text>
              </g>
            ))}
          </svg>
        </div>
        {/* detail panel */}
        <div className="hidden border-l border-line p-5 md:block">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle">Module · 3 files</div>
          <div className="mt-1 font-mono text-[13px] text-fg">fastapi/dependencies</div>
          <div className="mt-1.5 text-[12px] text-[#b45309]">Data — models, schemas and storage</div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Resolves the dependency-injection graph: inspects, validates and solves every endpoint’s parameters.
          </p>
          <div className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle">Start with</div>
          <div className="mt-1 space-y-0.5 font-mono text-[12px] text-fg">
            <div>utils.py</div>
            <div>models.py</div>
          </div>
          <div className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#2563eb]">Uses (3)</div>
          <div className="mt-1 space-y-1 text-[12px]">
            {[
              ["fastapi", "6×"],
              ["fastapi/_compat", "2×"],
              ["fastapi/security", "2×"],
            ].map(([m, n]) => (
              <div key={m} className="flex justify-between font-mono text-fg-2">
                <span>{m}</span>
                <span className="text-subtle">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
