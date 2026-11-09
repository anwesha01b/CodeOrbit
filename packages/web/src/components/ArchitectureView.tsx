import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import { Download, FileStack, Loader2, Maximize2, X } from "lucide-react";
import type { GraphEdgeDTO, GraphNodeDTO, Layer } from "@codeorbit/shared";
import { fetchGraph, type GraphFilters } from "../lib/api";
import { LAYER_COLOR, LAYER_HINT, LAYER_ORDER, layerColor, basename } from "../lib/graphColors";
import { dependencyRanks, placeRows } from "../lib/layered";
import { explainArrow, explainModule, summarizeArchitecture } from "../lib/explain";
import { GraphGuide, GraphTip, type TipState } from "./GraphGuide";
import { Crumbs, GraphError, Meaning, SearchBox, ToolButton, exportPng, useGraphKeys, type SearchItem } from "./GraphParts";
import { useOpenCode } from "./CodeDrawer";
import { useDetail } from "../lib/detail";

const STYLE = [
  {
    selector: "node.module",
    style: {
      shape: "round-rectangle",
      "background-color": "#ffffff",
      "border-width": 2,
      "border-color": "data(color)",
      width: "data(w)",
      height: 50,
      label: "data(label)",
      color: "#18181b",
      "font-size": 11.5,
      "font-family": "'Geist Mono', monospace",
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "line-height": 1.4,
    },
  },
  {
    selector: "node.band",
    style: {
      shape: "rectangle",
      "background-color": "data(color)",
      "background-opacity": 0.035,
      "border-width": 0,
      width: "data(w)",
      height: "data(h)",
      label: "",
      events: "no",
      "z-compound-depth": "bottom",
      "z-index": 0,
    },
  },
  {
    selector: "node.lanelabel",
    style: {
      "background-opacity": 0,
      "border-width": 0,
      width: 1,
      height: 1,
      label: "data(label)",
      color: "data(color)",
      "font-size": 12,
      "font-weight": 600,
      "font-family": "Geist, system-ui, sans-serif",
      "text-halign": "left",
      "text-valign": "center",
      "text-wrap": "wrap",
      "text-max-width": "130px",
      events: "no",
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(weight, 1, 40, 1.4, 5)",
      "line-color": "rgba(82,82,91,0.35)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(82,82,91,0.55)",
      "arrow-scale": 0.9,
      // generous invisible hit area so thin arrows are easy to click
      "overlay-padding": 6,
    },
  },
  { selector: "edge:active, edge.hover", style: { "line-color": "#18181b", "target-arrow-color": "#18181b" } },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: "edge.hl", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", opacity: 1 } },
  { selector: "edge.hl-in", style: { "line-color": "#c2410c", "target-arrow-color": "#c2410c", opacity: 1 } },
  { selector: "edge.picked", style: { "line-color": "#18181b", "target-arrow-color": "#18181b", width: 4, opacity: 1 } },
  { selector: "node.module:selected", style: { "border-width": 3.5, "background-color": "#f5f5f3" } },
] as unknown as cytoscape.StylesheetJson;

const LANE_GAP = 120;
const nodeWidth = (n: GraphNodeDTO) => Math.max(120, n.label.length * 7.4 + 32);

interface Lane {
  key: string;
  label: string;
  color: string;
  ids: string[];
}

/**
 * Lanes, top → bottom. With several roles present, one lane per role in request-flow order
 * (entry points at the top, helpers at the bottom). When everything shares one role, fall
 * back to dependency depth: modules built on top first, foundations last.
 */
function buildLanes(nodes: GraphNodeDTO[], edges: { source: string; target: string; weight: number }[]): Lane[] {
  const layers = new Set(nodes.map((n) => n.layer ?? "Core"));
  if (layers.size > 1) {
    return LAYER_ORDER.filter((l) => layers.has(l)).map((l) => ({
      key: l,
      label: l,
      color: LAYER_COLOR[l],
      ids: nodes.filter((n) => (n.layer ?? "Core") === l).map((n) => n.id),
    }));
  }
  const rank = dependencyRanks(
    nodes.map((n) => n.id),
    edges,
  );
  const max = Math.max(0, ...rank.values());
  const lanes: Lane[] = [];
  for (let r = max; r >= 0; r--) {
    const ids = nodes.filter((n) => rank.get(n.id) === r).map((n) => n.id);
    if (!ids.length) continue;
    const label = max === 0 ? "Modules" : r === max ? "Built on top" : r === 0 ? "Foundations" : `Level ${r}`;
    lanes.push({ key: `r${r}`, label, color: "#0284c7", ids });
  }
  return lanes;
}

type Picked =
  | { kind: "module"; node: GraphNodeDTO; uses: { id: string; weight: number }[]; usedBy: { id: string; weight: number }[] }
  | { kind: "edge"; edge: GraphEdgeDTO };

type Cy = Core & { focusNode?: (id: string) => void };

export function ArchitectureView({ jobId }: { jobId: string }) {
  const [params, setParams] = useSearchParams();
  const { beginner } = useDetail();
  const [filters, setFilters] = useState<GraphFilters>({});
  const [mode, setMode] = useState<"diagram" | "list">("diagram");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Cy | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["graph", jobId, "architecture", filters],
    queryFn: () => fetchGraph(jobId, "architecture", filters),
    enabled: !!jobId,
    placeholderData: keepPreviousData,
  });

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const layersPresent = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.layer ?? "Core"))] as Layer[], [data]);
  const summary = useMemo(() => (data ? summarizeArchitecture(data.nodes, data.edges) : []), [data]);
  const lanes = useMemo(() => (data ? buildLanes(data.nodes, data.edges) : []), [data]);
  const degree = useMemo(() => {
    const uses = new Map<string, number>();
    const usedBy = new Map<string, number>();
    for (const e of data?.edges ?? []) {
      uses.set(e.source, (uses.get(e.source) ?? 0) + 1);
      usedBy.set(e.target, (usedBy.get(e.target) ?? 0) + 1);
    }
    return { uses, usedBy };
  }, [data]);

  /** jump to another tab, e.g. the files of one module in the dependency graph */
  const goTo = (tab: string, extra: Record<string, string>) => setParams({ tab, ...extra });

  useEffect(() => {
    if (mode !== "diagram" || !data || !containerRef.current || data.nodes.length === 0) return;
    const widthOf = new Map(data.nodes.map((n) => [n.id, nodeWidth(n)]));
    const { pos, rowY, endY } = placeRows(
      lanes.map((l) => l.ids),
      data.edges,
      { width: (id) => widthOf.get(id) ?? 120, gapX: 44, rowGap: LANE_GAP, maxWidth: 1300 },
    );
    const xs = Object.entries(pos).flatMap(([id, p]) => [p.x - (widthOf.get(id) ?? 120) / 2, p.x + (widthOf.get(id) ?? 120) / 2]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);

    // lane geometry: from this lane's first row to the next lane's first row
    const laneTop = rowY.map((y) => y - LANE_GAP / 2 + 8);
    const laneBottom = rowY.map((_, i) => (i + 1 < rowY.length ? rowY[i + 1] : endY) - LANE_GAP / 2 - 8);
    const decor: ElementDefinition[] = lanes.flatMap((lane, i) => {
      const top = laneTop[i];
      const bottom = laneBottom[i];
      return [
        {
          data: { id: `band:${lane.key}`, color: lane.color, w: maxX - minX + 220, h: bottom - top },
          position: { x: (minX + maxX) / 2 - 70, y: (top + bottom) / 2 },
          classes: "band",
          selectable: false,
          grabbable: false,
        },
        {
          data: { id: `lane:${lane.key}`, label: lane.label, color: lane.color },
          position: { x: minX - 30, y: (top + bottom) / 2 },
          classes: "lanelabel",
          selectable: false,
          grabbable: false,
        },
      ];
    });

    const elements: ElementDefinition[] = [
      ...decor,
      ...data.nodes.map((n) => ({
        data: { id: n.id, label: `${n.label}\n${n.fileCount ?? 0} files`, color: layerColor(n.layer), w: widthOf.get(n.id) },
        position: pos[n.id],
        classes: "module",
      })),
      ...data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, weight: e.weight } })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: STYLE,
      layout: { name: "preset", fit: true, padding: 30 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.25,
      minZoom: 0.15,
      maxZoom: 2.5,
    }) as Cy;

    const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
    const edgesById = new Map(data.edges.map((e) => [e.id, e]));
    const reset = () => cy.elements().removeClass("faded hl hl-in picked");

    const focus = (id: string) => {
      const n = cy.$id(id);
      if (n.empty()) return;
      reset();
      cy.elements(".module, edge").addClass("faded");
      n.closedNeighborhood().removeClass("faded");
      n.outgoers("edge").addClass("hl");
      n.incomers("edge").addClass("hl-in");
      cy.$(":selected").unselect();
      n.select();
      const dto = nodesById.get(id);
      if (!dto) return;
      setPicked({
        kind: "module",
        node: dto,
        uses: n
          .outgoers("edge")
          .map((e) => ({ id: (e as cytoscape.EdgeSingular).target().id(), weight: e.data("weight") as number }))
          .sort((a, b) => b.weight - a.weight),
        usedBy: n
          .incomers("edge")
          .map((e) => ({ id: (e as cytoscape.EdgeSingular).source().id(), weight: e.data("weight") as number }))
          .sort((a, b) => b.weight - a.weight),
      });
    };
    cy.focusNode = focus;

    cy.on("tap", "node.module", (evt) => focus(evt.target.id()));
    cy.on("tap", "edge", (evt) => {
      const e = evt.target as cytoscape.EdgeSingular;
      const dto = edgesById.get(e.id());
      if (!dto) return;
      reset();
      cy.elements(".module, edge").addClass("faded");
      e.removeClass("faded").addClass("picked");
      e.source().removeClass("faded");
      e.target().removeClass("faded");
      cy.$(":selected").unselect();
      setPicked({ kind: "edge", edge: dto });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        reset();
        cy.$(":selected").unselect();
        setPicked(null);
      }
    });
    cy.on("mouseover", "node.module", (evt) => {
      const dto = nodesById.get(evt.target.id());
      if (!dto) return;
      const p = evt.target.renderedPosition();
      setTip({
        x: p.x,
        y: p.y,
        content: (
          <>
            <div className="font-mono text-[12px] text-fg">{dto.label}</div>
            <div className="mt-0.5 text-[11px]" style={{ color: layerColor(dto.layer) }}>
              {dto.layer} · {dto.layer ? LAYER_HINT[dto.layer] : ""}
            </div>
            {dto.summary && <p className="mt-1 line-clamp-4 text-muted">{dto.summary}</p>}
            <div className="mt-1 text-[10.5px] text-subtle">Click for details</div>
          </>
        ),
      });
    });
    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target as cytoscape.EdgeSingular;
      e.addClass("hover");
      const p = evt.renderedPosition ?? e.renderedMidpoint();
      setTip({
        x: p.x,
        y: p.y,
        content: (
          <span>
            <span className="font-mono text-fg">{e.source().id()}</span> uses <span className="font-mono text-fg">{e.target().id()}</span>
            <span className="block text-[10.5px] text-subtle">{e.data("weight")} imports · click to see which files</span>
          </span>
        ),
      });
    });
    cy.on("mouseout", "node, edge", (evt) => {
      evt.target.removeClass("hover");
      setTip(null);
    });
    cy.on("viewport", () => setTip(null));

    cyRef.current = cy;

    // deep link: ?tab=architecture&focus=<module>
    const want = params.get("focus");
    if (want && nodesById.has(want)) {
      focus(want);
      cy.animate({ center: { eles: cy.$id(want) } }, { duration: 300 });
    }

    return () => {
      cy.destroy();
      cyRef.current = null;
      setPicked(null);
      setTip(null);
    };
    // params are read once per layout on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lanes, mode]);

  const searchRef = useRef<HTMLInputElement>(null);
  const searchItems = useMemo<SearchItem[]>(
    () => (data?.nodes ?? []).map((n) => ({ id: n.id, label: n.label, sub: n.layer ?? "", kind: "module" })),
    [data],
  );
  useGraphKeys({
    search: () => searchRef.current?.focus(),
    reset: () => {
      cyRef.current?.elements().removeClass("faded hl hl-in picked").unselect();
      setPicked(null);
    },
    fit: () => cyRef.current?.fit(undefined, 30),
  });

  const focus = (id: string) => {
    if (mode === "list") setMode("diagram");
    const cy = cyRef.current;
    if (!cy) {
      setParams({ tab: "architecture", focus: id });
      return;
    }
    cy.focusNode?.(id);
    cy.animate({ center: { eles: cy.$id(id) } }, { duration: 300 });
  };

  return (
    <div className="relative">
      <GraphGuide
        id="architecture"
        layers={layersPresent}
        steps={[
          <>Each box is a <b className="text-fg">module</b>: a folder of related files. The number is how many files it holds.</>,
          <>Bands group modules by <b className="text-fg">role</b>: where requests enter at the top, shared foundations at the bottom.</>,
          <>An arrow <span className="font-mono">A → B</span> means code in A imports B. Click an arrow to see exactly which files.</>,
          <>Click a box for a plain-English explanation, then “See its files” to open that module in the dependency graph.</>,
        ]}
      />

      {beginner && summary.length > 0 && (
        <div className="border-b border-line px-4 py-3 text-[13.5px] leading-relaxed text-fg-2">
          <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle">In short</span>
          {summary.join(" ")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <SearchBox items={searchItems} placeholder="Find a module…" onPick={focus} inputRef={searchRef} />
        <div role="group" aria-label="View" className="flex items-center rounded-md border border-line p-0.5">
          {(["diagram", "list"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded px-2 py-0.5 text-xs capitalize transition-colors ${mode === m ? "bg-black/[0.07] text-fg" : "text-muted hover:text-fg"}`}
            >
              {m}
            </button>
          ))}
        </div>
        {(
          [
            { key: "tests", label: "Tests" },
            { key: "other", label: "Docs, examples & tooling" },
          ] as { key: keyof GraphFilters; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setFilters((f) => ({ ...f, [t.key]: !f[t.key] }))}
            aria-pressed={!!filters[t.key]}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              filters[t.key] ? "border-accent/50 bg-accent/15 text-accent-soft" : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
        {mode === "diagram" && (
          <>
            <ToolButton onClick={() => cyRef.current?.fit(undefined, 30)}>
              <Maximize2 size={12} aria-hidden /> Fit
            </ToolButton>
            <ToolButton onClick={() => exportPng(cyRef.current, "architecture.png")} label="Download the diagram as a PNG image">
              <Download size={12} aria-hidden /> PNG
            </ToolButton>
          </>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-subtle">
          {isFetching && <Loader2 size={12} className="animate-spin" />}
          {data && `${data.nodes.length} modules · ${data.edges.length} dependencies`}
        </span>
      </div>

      {isLoading ? (
        <div className="flex h-[600px] items-center justify-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading architecture…
        </div>
      ) : error ? (
        <GraphError what="architecture map" onRetry={() => refetch()} />
      ) : !data || data.nodes.length === 0 ? (
        <p className="p-6 text-sm text-muted">No product-code modules were detected. Turn on Tests or Docs to include them.</p>
      ) : mode === "list" ? (
        <ModuleTable lanes={lanes} byId={byId} degree={degree} onPick={focus} onFiles={(id) => goTo("deps", { scope: id })} />
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-[600px] w-full bg-canvas-dim" />
          <GraphTip tip={tip} />
          {picked && (
            <aside
              aria-label="Details"
              className="relative m-3 rounded-lg border border-line bg-surface/95 p-4 shadow-lift backdrop-blur md:absolute md:right-3 md:top-3 md:m-0 md:max-h-[580px] md:w-80 md:overflow-y-auto"
            >
              <button
                onClick={() => {
                  cyRef.current?.elements().removeClass("faded hl hl-in picked").unselect();
                  setPicked(null);
                }}
                className="float-right text-subtle hover:text-fg"
                aria-label="Close details"
              >
                <X size={14} />
              </button>
              {picked.kind === "module" ? (
                <ModulePanel
                  p={picked}
                  byId={byId}
                  onPick={focus}
                  onFiles={() => goTo("deps", { scope: picked.node.id })}
                />
              ) : (
                <EdgePanel edge={picked.edge} onPick={focus} onFiles={() => goTo("deps", { scope: picked.edge.source })} />
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function ModulePanel({
  p,
  byId,
  onPick,
  onFiles,
}: {
  p: Extract<Picked, { kind: "module" }>;
  byId: Map<string, GraphNodeDTO>;
  onPick: (id: string) => void;
  onFiles: () => void;
}) {
  const n = p.node;
  const openCode = useOpenCode();
  return (
    <>
      <Crumbs items={[...(n.layer ? [{ label: n.layer }] : []), { label: n.label, mono: true }]} />
      <div className="text-[10px] uppercase tracking-wide text-subtle">Module · {n.fileCount ?? 0} files</div>
      <div className="mt-1 break-all font-mono text-[13px] text-fg">{n.label}</div>
      {n.layer && (
        <div className="mt-1.5 text-[11.5px]" style={{ color: layerColor(n.layer) }}>
          {n.layer}: {LAYER_HINT[n.layer]}
        </div>
      )}
      {n.summary && <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-2">{n.summary}</p>}
      <Meaning lines={explainModule(n, p.uses.length, p.usedBy.length)} />
      <button onClick={onFiles} className="btn-primary mt-3 h-8 w-full px-3 py-0 text-xs">
        <FileStack size={13} aria-hidden /> See its files
      </button>
      {n.keyFiles && n.keyFiles.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-subtle">Start with these files (click to read)</div>
          <ul className="mt-1 space-y-0.5">
            {n.keyFiles.map((f) => (
              <li key={f}>
                <button
                  onClick={() => openCode({ path: f, title: `Start file of ${n.label}` })}
                  className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11.5px] text-fg hover:bg-black/[0.04]"
                  title={`Read ${f}`}
                >
                  {basename(f)}
                  <span className="text-subtle"> · {f.slice(0, f.lastIndexOf("/") + 1)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ModuleList title="Uses" tone="text-[#2563eb]" items={p.uses} byId={byId} onPick={onPick} />
      <ModuleList title="Used by" tone="text-[#c2410c]" items={p.usedBy} byId={byId} onPick={onPick} />
    </>
  );
}

function EdgePanel({ edge, onPick, onFiles }: { edge: GraphEdgeDTO; onPick: (id: string) => void; onFiles: () => void }) {
  const files = edge.examples ?? [];
  const openCode = useOpenCode();
  return (
    <>
      <div className="text-[10px] uppercase tracking-wide text-subtle">Dependency · {edge.weight} imports</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[12.5px] text-fg">
        <button onClick={() => onPick(edge.source)} className="underline decoration-line-strong underline-offset-2 hover:decoration-fg">
          {edge.source}
        </button>
        <span className="text-subtle">→</span>
        <button onClick={() => onPick(edge.target)} className="underline decoration-line-strong underline-offset-2 hover:decoration-fg">
          {edge.target}
        </button>
      </div>
      <Meaning lines={[explainArrow(edge)]} />
      <div className="mt-3 text-[10px] uppercase tracking-wide text-subtle">The imports behind this arrow</div>
      {files.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-subtle">No file-level detail recorded.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {files.map((f) => (
            <li
              key={`${f.from}>${f.to}`}
              className="cursor-pointer rounded border border-line bg-surface px-2 py-1.5 font-mono text-[11px] leading-snug hover:border-line-strong"
              onClick={() => openCode({ path: f.from, title: `Imports ${basename(f.to)}` })}
              title={`Read ${f.from}`}
            >
              <span className="text-fg">{basename(f.from)}</span>
              <span className="text-subtle"> imports </span>
              <span className="text-fg">{basename(f.to)}</span>
              <div className="truncate text-[10px] text-subtle" title={`${f.from} → ${f.to}`}>
                {f.from}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edge.weight > files.length && files.length > 0 && (
        <p className="mt-1 text-[10.5px] text-subtle">Showing the {files.length} strongest of {edge.weight} imports.</p>
      )}
      <button onClick={onFiles} className="btn-ghost mt-3 h-8 w-full px-3 py-0 text-xs">
        <FileStack size={13} aria-hidden /> See {edge.source}’s files
      </button>
    </>
  );
}

function ModuleList({
  title,
  tone,
  items,
  byId,
  onPick,
}: {
  title: string;
  tone: string;
  items: { id: string; weight: number }[];
  byId: Map<string, GraphNodeDTO>;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className={`text-[10px] uppercase tracking-wide ${tone}`}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-subtle">{title === "Uses" ? "Doesn’t depend on other modules shown." : "Nothing shown depends on it."}</p>
      ) : (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
          {items.map((m) => (
            <li key={m.id}>
              <button onClick={() => onPick(m.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-black/[0.04]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: layerColor(byId.get(m.id)?.layer) }} />
                <span className="truncate font-mono text-[11.5px] text-fg">{m.id}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-subtle">{m.weight}×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Accessible list alternative to the diagram: every module with its role, size and links. */
function ModuleTable({
  lanes,
  byId,
  degree,
  onPick,
  onFiles,
}: {
  lanes: Lane[];
  byId: Map<string, GraphNodeDTO>;
  degree: { uses: Map<string, number>; usedBy: Map<string, number> };
  onPick: (id: string) => void;
  onFiles: (id: string) => void;
}) {
  return (
    <div className="max-h-[600px] overflow-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-subtle">
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 font-medium">Module</th>
            <th className="px-3 py-2.5 font-medium">Role</th>
            <th className="px-3 py-2.5 text-right font-medium">Files</th>
            <th className="px-3 py-2.5 text-right font-medium">Uses</th>
            <th className="px-3 py-2.5 text-right font-medium">Used by</th>
            <th className="px-3 py-2.5 font-medium">What it does</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {lanes.flatMap((lane) =>
            lane.ids.map((id) => {
              const n = byId.get(id)!;
              return (
                <tr key={id} className="border-b border-line align-top hover:bg-sunken">
                  <td className="px-4 py-2.5">
                    <button onClick={() => onPick(id)} className="font-mono text-[12.5px] text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                      {n.label}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-fg-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: layerColor(n.layer) }} aria-hidden />
                      {n.layer}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{n.fileCount ?? 0}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{degree.uses.get(id) ?? 0}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{degree.usedBy.get(id) ?? 0}</td>
                  <td className="max-w-md px-3 py-2.5 text-muted">
                    <span className="line-clamp-2">{n.summary ?? (n.layer ? LAYER_HINT[n.layer] : "")}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onFiles(id)} className="whitespace-nowrap text-[12px] font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                      See files
                    </button>
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}
