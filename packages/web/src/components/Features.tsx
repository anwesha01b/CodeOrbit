import type { ReactNode } from "react";

/** Six views of every repository, each shown as a fragment of CodeOrbit's real UI. */
export function Features() {
  return (
    <section id="product" className="border-b border-line py-24 sm:py-32">
      <div className="container-rl">
        <div className="max-w-2xl">
          <p className="eyebrow">Product</p>
          <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-heading sm:text-[44px]">Six views of every repository</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            One analysis gives you the structure, the flow of calls, a reading order and work you can pick up.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="Shows modules by role" body="Lanes sort folders into API, core, data and helpers.">
            <Lanes />
          </Card>
          <Card title="Traces every import" body="Click a file to see what it uses and what uses it.">
            <Imports />
          </Card>
          <Card title="Follows calls top to bottom" body="Read execution downward, with the line each function lives on.">
            <Calls />
          </Card>
          <Card title="Answers with file citations" body="Ask in plain English; every answer links to the code.">
            <Chat />
          </Card>
          <Card title="Walks you through in order" body="A guided tour from the entry point to the helpers.">
            <Tour />
          </Card>
          <Card title="Ranks issues you can fix" body="Open issues and TODOs sorted by priority and difficulty.">
            <Matrix />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <article className="card card-link flex flex-col overflow-hidden">
      <div className="grid-backdrop flex h-44 items-center justify-center border-b border-line bg-canvas-dim px-5">{children}</div>
      <div className="p-5">
        <h3 className="text-[16px] font-medium tracking-[-0.01em]">{title}</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{body}</p>
      </div>
    </article>
  );
}

const mono = "font-mono text-[11px]";

function Lanes() {
  const rows: [string, string, string[]][] = [
    ["API", "#2563eb", ["routing"]],
    ["Core", "#0284c7", ["applications", "params"]],
    ["Data", "#d97706", ["dependencies"]],
    ["Utility", "#71717a", ["_compat", "utils"]],
  ];
  return (
    <div className="w-full space-y-1.5">
      {rows.map(([name, color, mods]) => (
        <div key={name} className="flex items-center gap-2 rounded px-2 py-1" style={{ background: `${color}0f` }}>
          <span className="w-12 shrink-0 text-[11px] font-semibold" style={{ color }}>
            {name}
          </span>
          {mods.map((m) => (
            <span key={m} className={`${mono} rounded border bg-surface px-1.5 py-0.5 text-fg`} style={{ borderColor: color }}>
              {m}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Imports() {
  const nodes = [
    { x: 100, y: 62, r: 9, c: "#0284c7", label: "routing.py", main: true },
    { x: 34, y: 22, r: 5, c: "#0284c7" },
    { x: 40, y: 104, r: 6, c: "#d97706" },
    { x: 168, y: 26, r: 5, c: "#2563eb" },
    { x: 172, y: 100, r: 6, c: "#71717a" },
    { x: 104, y: 120, r: 4, c: "#0284c7" },
  ];
  return (
    <svg viewBox="0 0 200 140" className="h-36 w-auto" aria-hidden>
      {nodes.slice(1).map((n, i) => (
        <line
          key={i}
          x1={nodes[0].x}
          y1={nodes[0].y}
          x2={n.x}
          y2={n.y}
          stroke={i < 2 ? "#2563eb" : "#c2410c"}
          strokeWidth="1.4"
          strokeDasharray="4 3"
          className="pulse-line"
        />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={n.c} stroke={n.main ? "#18181b" : "#ffffff"} strokeWidth={n.main ? 2 : 1.5} />
      ))}
      <rect x="68" y="78" width="64" height="15" rx="3" fill="#ffffff" />
      <text x="100" y="89" textAnchor="middle" fontSize="10" fill="#18181b" fontFamily="'Geist Mono', monospace">
        routing.py
      </text>
    </svg>
  );
}

function Calls() {
  const steps = [
    ["app()", "routing.py:142"],
    ["handle()", "routing.py:1314"],
    ["_match()", "routing.py:1787"],
    ["matches()", "routing.py:886"],
  ];
  return (
    <ol className="w-full space-y-0">
      {steps.map(([fn, at], i) => (
        <li key={fn} className="flex flex-col items-start">
          <div className="flex w-full items-center justify-between rounded border border-line bg-surface px-2 py-1">
            <span className={`${mono} text-fg`}>{fn}</span>
            <span className={`${mono} text-subtle`}>{at}</span>
          </div>
          {i < steps.length - 1 && <span className="ml-4 h-2 w-px bg-[#2563eb]" />}
        </li>
      ))}
    </ol>
  );
}

function Chat() {
  return (
    <div className="w-full space-y-2 text-[12px]">
      <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-fg px-2.5 py-1.5 text-white">How are dependencies resolved?</div>
      <div className="w-fit max-w-[92%] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-fg-2">
        Each endpoint’s parameters are solved recursively by <code className="font-mono text-fg">solve_dependencies</code>.
        <div className="mt-1.5 flex gap-1">
          {["dependencies/utils.py", "routing.py"].map((c) => (
            <span key={c} className={`${mono} rounded border border-line bg-sunken px-1.5 py-0.5 text-fg-2`}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tour() {
  const stops = ["Start at the entry point", "Routing and requests", "Dependency injection", "Security and auth"];
  return (
    <ol className="w-full space-y-1.5">
      {stops.map((s, i) => (
        <li
          key={s}
          className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-[12px] ${i === 1 ? "border border-fg bg-surface text-fg" : "text-muted"}`}
        >
          <span className="font-mono text-[11px] text-subtle">{String(i + 1).padStart(2, "0")}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

function Matrix() {
  const rows: [string, number[]][] = [
    ["High", [1, 3, 0]],
    ["Medium", [3, 18, 4]],
    ["Low", [5, 36, 2]],
  ];
  return (
    <div className="grid grid-cols-[52px_repeat(3,40px)] gap-1 text-[10.5px]">
      <span />
      {["Easy", "Med", "Hard"].map((d) => (
        <span key={d} className="text-center text-subtle">
          {d}
        </span>
      ))}
      {rows.map(([p, ns]) => (
        <div key={p} className="contents">
          <span className="self-center text-muted">{p}</span>
          {ns.map((n, i) => (
            <span
              key={i}
              className={`flex h-8 items-center justify-center rounded border font-mono text-[12px] ${
                i === 0 && p !== "Low" ? "border-emerald-300 bg-accent-wash text-emerald-800" : "border-line bg-surface text-fg-2"
              }`}
            >
              {n}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
