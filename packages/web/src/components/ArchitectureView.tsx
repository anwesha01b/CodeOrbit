import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import { Loader2, Maximize2, X } from "lucide-react";
import type { GraphNodeDTO, Layer } from "@codeorbit/shared";
import { fetchGraph, type GraphFilters } from "../lib/api";
import { LAYER_COLOR, LAYER_HINT, LAYER_ORDER, layerColor, basename } from "../lib/graphColors";
import { dependencyRanks, placeRows } from "../lib/layered";
import { GraphGuide, GraphTip, type TipState } from "./GraphGuide";

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
      width: "mapData(weight, 1, 40, 1.2, 5)",
      "line-color": "rgba(82,82,91,0.35)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(82,82,91,0.55)",
      "arrow-scale": 0.9,
    },
  },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: "edge.hl", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", opacity: 1 } },
  { selector: "edge.hl-in", style: { "line-color": "#c2410c", "target-arrow-color": "#c2410c", opacity: 1 } },
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

interface Selected {
  node: GraphNodeDTO;
  uses: { id: string; weight: number }[];
  usedBy: { id: string; weight: number }[];
}

export function ArchitectureView({ jobId }: { jobId: string }) {
  const [filters, setFilters] = useState<GraphFilters>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<(Core & { focusNode?: (id: string) => void }) | null>(null);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["graph", jobId, "architecture", filters],
    queryFn: () => fetchGraph(jobId, "architecture", filters),
    enabled: !!jobId,
    placeholderData: keepPreviousData,
  });

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const layersPresent = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.layer ?? "Core"))] as Layer[], [data]);

  useEffect(() => {
    if (!data || !containerRef.current || data.nodes.length === 0) return;
    const widthOf = new Map(data.nodes.map((n) => [n.id, nodeWidth(n)]));
    const lanes = buildLanes(data.nodes, data.edges);
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
        data: {
          id: n.id,
          label: `${n.label}\n${n.fileCount ?? 0} files`,
          color: layerColor(n.layer),
          w: widthOf.get(n.id),
        },
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
      autoungrabify: false,
    }) as Core & { focusNode?: (id: string) => void };

    const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
    const focus = (id: string) => {
      const n = cy.$id(id);
      if (n.empty()) return;
      cy.elements(".module, edge").addClass("faded").removeClass("hl hl-in");
      n.closedNeighborhood().removeClass("faded");
      n.outgoers("edge").addClass("hl");
      n.incomers("edge").addClass("hl-in");
      cy.$(":selected").unselect();
      n.select();
      const dto = nodesById.get(id);
      if (!dto) return;
      setSelected({
        node: dto,
        uses: n.outgoers("edge").map((e) => ({ id: (e as cytoscape.EdgeSingular).target().id(), weight: e.data("weight") as number })).sort((a, b) => b.weight - a.weight),
        usedBy: n.incomers("edge").map((e) => ({ id: (e as cytoscape.EdgeSingular).source().id(), weight: e.data("weight") as number })).sort((a, b) => b.weight - a.weight),
      });
    };
    cy.focusNode = focus;

    cy.on("tap", "node.module", (evt) => focus(evt.target.id()));
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("faded hl hl-in");
        cy.$(":selected").unselect();
        setSelected(null);
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
      const e = evt.target;
      const p = evt.renderedPosition ?? e.renderedMidpoint();
      setTip({
        x: p.x,
        y: p.y,
        content: (
          <span>
            <span className="font-mono text-fg">{e.source().id()}</span> uses{" "}
            <span className="font-mono text-fg">{e.target().id()}</span>
            <span className="block text-[10.5px] text-subtle">{e.data("weight")} import statements</span>
          </span>
        ),
      });
    });
    cy.on("mouseout", "node, edge", () => setTip(null));
    cy.on("viewport", () => setTip(null));

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
      setSelected(null);
      setTip(null);
    };
  }, [data]);

  const focus = (id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
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
          <>An arrow <span className="font-mono">A → B</span> means code in A imports B. Thicker arrows mean more imports.</>,
          <>Hover a box for a plain-English summary; click it to see what it uses (blue) and what uses it (amber).</>,
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
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
              filters[t.key]
                ? "border-accent/50 bg-accent/15 text-accent-soft"
                : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => cyRef.current?.fit(undefined, 30)}
          className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          <Maximize2 size={12} /> Fit
        </button>
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
        <p className="p-6 text-red-600">Couldn’t load the architecture map.</p>
      ) : !data || data.nodes.length === 0 ? (
        <p className="p-6 text-sm text-muted">No product-code modules were detected. Try including tests or docs.</p>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-[600px] w-full bg-canvas-dim" />
          <GraphTip tip={tip} />
      {selected && (
        <div className="absolute right-3 top-3 max-h-[570px] w-80 overflow-y-auto rounded-lg border border-line bg-surface/95 p-4 shadow-lift backdrop-blur">
          <button
            onClick={() => {
              cyRef.current?.elements().removeClass("faded hl hl-in").unselect();
              setSelected(null);
            }}
            className="float-right text-subtle hover:text-fg"
            aria-label="Close details"
          >
            <X size={14} />
          </button>
          <div className="text-[10px] uppercase tracking-wide text-subtle">Module · {selected.node.fileCount ?? 0} files</div>
          <div className="mt-1 break-all font-mono text-[13px] text-fg">{selected.node.label}</div>
          {selected.node.layer && (
            <div className="mt-1.5 text-[11.5px]" style={{ color: layerColor(selected.node.layer) }}>
              {selected.node.layer} — {LAYER_HINT[selected.node.layer]}
            </div>
          )}
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-2">
            {selected.node.summary ?? "No AI summary for this module yet. Generate AI summaries on the Overview tab to get one."}
          </p>
          {selected.node.keyFiles && selected.node.keyFiles.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-subtle">Start with these files</div>
              <ul className="mt-1 space-y-0.5">
                {selected.node.keyFiles.map((f) => (
                  <li key={f} className="truncate font-mono text-[11.5px] text-fg" title={f}>
                    {basename(f)}
                    <span className="text-subtle"> · {f.slice(0, f.lastIndexOf("/") + 1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ModuleList title="Uses" tone="text-accent-soft" items={selected.uses} byId={byId} onPick={focus} />
          <ModuleList title="Used by" tone="text-warn" items={selected.usedBy} byId={byId} onPick={focus} />
        </div>
      )}
        </div>
      )}
    </div>
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
        <p className="mt-1 text-[11px] text-subtle">
          {title === "Uses" ? "Doesn’t depend on other modules shown." : "Nothing shown depends on it."}
        </p>
      ) : (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
          {items.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onPick(m.id)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-black/[0.04]"
              >
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
