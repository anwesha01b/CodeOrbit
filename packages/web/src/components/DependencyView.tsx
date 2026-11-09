import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import { Loader2, X, Search, Maximize2 } from "lucide-react";
import type { GraphNodeDTO, Layer } from "@codeorbit/shared";
import { fetchGraph, type GraphFilters } from "../lib/api";
import { colorFor, basename, layerColor, LAYER_HINT } from "../lib/graphColors";
import { dependencyRanks, groupedPositions, placeRows } from "../lib/layered";
import { FileInsight } from "./FileInsight";
import { GraphGuide, GraphTip, type TipState } from "./GraphGuide";

type Mode = "dependency" | "call";
type LayoutMode = "grouped" | "flow";
type ColorMode = "layer" | "module";

const LABELED_TOP = 30; // always label this many best-connected nodes

const STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      width: "mapData(deg, 1, 30, 12, 44)",
      height: "mapData(deg, 1, 30, 12, 44)",
      "border-width": 1,
      "border-color": "#ffffff",
      label: "",
      color: "#3f3f46",
      "font-size": 10,
      "font-family": "'Geist Mono', monospace",
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.85,
      "text-background-padding": 2,
      "min-zoomed-font-size": 5,
    },
  },
  { selector: "node.labeled, node.hover", style: { label: "data(short)", "font-size": 12 } },
  {
    selector: "node.entry",
    style: { shape: "star", width: 34, height: 34, "border-width": 1.5, "border-color": "#18181b", label: "data(short)", "font-size": 12, color: "#18181b" },
  },
  { selector: 'node[type="external_package"]', style: { shape: "round-diamond", "background-color": "#a1a1aa" } },
  {
    selector: "node.group",
    style: {
      shape: "round-rectangle",
      "background-color": "data(color)",
      "background-opacity": 0.05,
      "border-width": 1,
      "border-style": "dashed",
      "border-color": "data(color)",
      "border-opacity": 0.55,
      label: "data(short)",
      "font-size": 11,
      color: "data(color)",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -4,
      "text-background-opacity": 0,
      padding: 14,
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(weight, 1, 6, 0.7, 2.4)",
      "line-color": "rgba(82,82,91,0.22)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(82,82,91,0.4)",
      "arrow-scale": 0.6,
    },
  },
  { selector: ".faded", style: { opacity: 0.08, "text-opacity": 0 } },
  { selector: "node.group.faded", style: { opacity: 0.25, "text-opacity": 0.4 } },
  { selector: "edge.hl", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", width: 2, opacity: 1 } },
  { selector: "edge.hl-in", style: { "line-color": "#c2410c", "target-arrow-color": "#c2410c", width: 2, opacity: 1 } },
  { selector: "node.hl", style: { label: "data(short)", opacity: 1 } },
  {
    selector: "node.impact",
    style: { "border-width": 2.5, "border-color": "#c2410c", label: "data(short)", opacity: 1, "text-opacity": 1, "z-index": 20 },
  },
  {
    selector: "node:selected",
    style: { "border-width": 3, "border-color": "#18181b", label: "data(short)", "font-size": 12, color: "#18181b", "z-index": 30 },
  },
] as unknown as cytoscape.StylesheetJson;

interface Neighbour {
  id: string;
  label: string;
  sub?: string;
}

interface Selected {
  node: GraphNodeDTO;
  out: Neighbour[];
  in: Neighbour[];
}

type Cy = Core & { focusNode?: (id: string) => void };

const COPY = {
  dependency: {
    guide: [
      <>Each dot is a <b className="text-fg">file</b>. Dashed boxes group the files of one module.</>,
      <>An arrow <span className="font-mono">A → B</span> means file A imports file B. Bigger dots are imported by more files.</>,
      <>A <b className="text-fg">★ star</b> marks the best places to start reading.</>,
      <>Click a file: <span className="text-accent-soft">blue</span> = what it imports, <span className="text-warn">amber</span> = what imports it. “Show impact” traces everything a change could break.</>,
    ],
    out: "Imports",
    in: "Imported by",
    noun: "files",
  },
  call: {
    guide: [
      <>Each dot is a <b className="text-fg">function or method</b>. In “Grouped”, boxes hold the functions of one file.</>,
      <>An arrow <span className="font-mono">A → B</span> means A calls B. In “Top-down flow”, callers sit above what they call: read downward to follow execution.</>,
      <>Calls across files are matched by name, so a few links can be approximate.</>,
      <>Click a function to list what it calls (<span className="text-accent-soft">blue</span>) and who calls it (<span className="text-warn">amber</span>).</>,
    ],
    out: "Calls",
    in: "Called by",
    noun: "functions",
  },
};

export function DependencyView({ jobId, graphType = "dependency" }: { jobId: string; graphType?: Mode }) {
  const isCall = graphType === "call";
  const copy = COPY[graphType];
  const [filters, setFilters] = useState<GraphFilters>({ limit: isCall ? 80 : 250 });
  const [layout, setLayout] = useState<LayoutMode>(isCall ? "flow" : "grouped");
  const [colorBy, setColorBy] = useState<ColorMode>("layer");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Cy | null>(null);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["graph", jobId, graphType, filters],
    queryFn: () => fetchGraph(jobId, graphType, filters),
    enabled: !!jobId,
    placeholderData: keepPreviousData,
  });

  const layersPresent = useMemo(
    () => [...new Set((data?.nodes ?? []).filter((n) => n.layer).map((n) => n.layer!))] as Layer[],
    [data],
  );

  useEffect(() => {
    if (!data || !containerRef.current || data.nodes.length === 0) return;
    const degree = new Map<string, number>();
    for (const e of data.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const top = new Set(
      [...data.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, LABELED_TOP).map((n) => n.id),
    );
    const grouped = layout === "grouped";
    const byIdLocal0 = new Map(data.nodes.map((n) => [n.id, n]));
    const groupKey = (n: GraphNodeDTO) => (n.type === "external_package" ? null : n.clusterId);
    const groups = new Map<string, GraphNodeDTO[]>();
    if (grouped) {
      for (const n of data.nodes) {
        const k = groupKey(n);
        if (k) groups.set(k, [...(groups.get(k) ?? []), n]);
      }
    }
    const nodeColor = (n: GraphNodeDTO) =>
      n.type === "external_package" ? "#a1a1aa" : colorBy === "layer" ? layerColor(n.layer) : colorFor(n.clusterId);

    const elements: ElementDefinition[] = [
      ...[...groups].map(([k, members]) => ({
        data: {
          id: `grp:${k}`,
          short: isCall ? basename(k) : k,
          color: colorBy === "layer" ? layerColor(members[0].layer) : colorFor(k),
        },
        classes: "group",
        selectable: false,
      })),
      ...data.nodes.map((n) => {
        const k = groupKey(n);
        return {
          data: {
            id: n.id,
            type: n.type,
            parent: grouped && k ? `grp:${k}` : undefined,
            short: n.type === "file" ? basename(n.label) : n.type === "symbol" ? `${n.label}()` : n.label,
            color: nodeColor(n),
            deg: degree.get(n.id) ?? 1,
          },
          classes: [top.has(n.id) ? "labeled" : "", n.entry ? "entry" : ""].join(" ").trim(),
        };
      }),
      ...data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, weight: e.weight } })),
    ];

    let layoutOpts: cytoscape.LayoutOptions;
    if (grouped) {
      const boxes = new Map(groups);
      const loose = data.nodes.filter((n) => !groupKey(n)).map((n) => n.id);
      if (loose.length) boxes.set("\u0001loose", loose.map((id) => byIdLocal0.get(id)!));
      const pos = groupedPositions(
        new Map([...boxes].map(([k, ns]) => [k, ns.map((n) => n.id)])),
        data.edges,
        isCall ? { cellW: 120, cellH: 54 } : {},
      );
      layoutOpts = { name: "preset", positions: pos, fit: true, padding: 30 } as cytoscape.LayoutOptions;
    } else {
      const ids = data.nodes.map((n) => n.id);
      const rank = dependencyRanks(ids, data.edges);
      const max = Math.max(0, ...rank.values());
      const rows: string[][] = [];
      for (let r = max; r >= 0; r--) rows.push(ids.filter((id) => rank.get(id) === r));
      const { pos } = placeRows(rows.filter((r) => r.length), data.edges, {
        width: (id) => (top.has(id) ? 90 : 34),
        gapX: 22,
        rowGap: 95,
        maxWidth: 1900,
      });
      layoutOpts = { name: "preset", positions: pos, fit: true, padding: 30 } as cytoscape.LayoutOptions;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: STYLE,
      layout: layoutOpts,
      wheelSensitivity: 0.25,
      minZoom: 0.05,
      maxZoom: 3,
    }) as Cy;

    const byIdLocal = new Map(data.nodes.map((n) => [n.id, n]));
    const describe = (id: string): Neighbour => {
      const n = byIdLocal.get(id);
      if (!n) return { id, label: id };
      if (n.type === "symbol") return { id, label: `${n.label}()`, sub: n.file ? `${basename(n.file)}${n.line ? `:${n.line}` : ""}` : undefined };
      if (n.type === "file") return { id, label: basename(n.label), sub: n.label.slice(0, n.label.lastIndexOf("/") + 1) };
      return { id, label: n.label, sub: "external package" };
    };
    const focus = (id: string) => {
      const node = cy.$id(id);
      if (node.empty()) return;
      cy.elements().addClass("faded").removeClass("hl hl-in impact");
      const hood = node.closedNeighborhood();
      hood.removeClass("faded");
      hood.nodes().addClass("hl");
      hood.parents().removeClass("faded");
      node.outgoers("edge").addClass("hl");
      node.incomers("edge").addClass("hl-in");
      cy.$(":selected").unselect();
      node.select();
      const dto = byIdLocal.get(id);
      if (dto) {
        setSelected({
          node: dto,
          out: node.outgoers("node").map((x) => describe(x.id())),
          in: node.incomers("node").map((x) => describe(x.id())),
        });
      }
    };
    const clear = () => {
      cy.elements().removeClass("faded hl hl-in impact");
      cy.$(":selected").unselect();
      setSelected(null);
    };

    cy.on("tap", "node", (evt) => !evt.target.hasClass("group") && focus(evt.target.id()));
    cy.on("tap", (evt) => evt.target === cy && clear());
    cy.on("mouseover", "node", (evt) => {
      const el = evt.target;
      if (el.hasClass("group")) return;
      el.addClass("hover");
      const n = byIdLocal.get(el.id());
      if (!n) return;
      const p = el.renderedPosition();
      const inCount = el.incomers("node").length;
      const outCount = el.outgoers("node").length;
      setTip({
        x: p.x,
        y: p.y,
        content: (
          <>
            <div className="break-all font-mono text-[12px] text-fg">
              {n.type === "symbol" ? `${n.label}()` : n.label}
              {n.entry && <span className="ml-1 text-amber-700">★ start here</span>}
            </div>
            {n.type === "symbol" && n.file && (
              <div className="break-all font-mono text-[10.5px] text-subtle">
                {n.file}
                {n.line ? `:${n.line}` : ""}
              </div>
            )}
            {n.layer && (
              <div className="mt-0.5 text-[11px]" style={{ color: layerColor(n.layer) }}>
                {n.layer} · {LAYER_HINT[n.layer]}
              </div>
            )}
            {n.summary && <p className="mt-1 line-clamp-4 text-muted">{n.summary}</p>}
            <div className="mt-1 text-[10.5px] text-subtle">
              {n.type === "external_package"
                ? `used by ${inCount} files`
                : isCall
                  ? `called by ${inCount} · calls ${outCount}`
                  : `imported by ${inCount} · imports ${outCount}`}
            </div>
          </>
        ),
      });
    });
    cy.on("mouseout", "node", (evt) => {
      evt.target.removeClass("hover");
      setTip(null);
    });
    cy.on("viewport", () => setTip(null));
    cy.focusNode = focus;

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
      setSelected(null);
      setTip(null);
    };
  }, [data, layout, colorBy, isCall]);

  /** Paint the blast radius: affected files glow amber, everything else fades. null restores the neighbourhood view. */
  const showImpact = useCallback(
    (paths: string[] | null) => {
      const cy = cyRef.current;
      if (!cy || !data || !selected) return;
      if (!paths) {
        cy.focusNode?.(selected.node.id);
        return;
      }
      const hit = new Set(paths);
      const byLabel = new Map(data.nodes.map((n) => [n.id, n.label]));
      cy.elements().addClass("faded").removeClass("hl hl-in impact");
      const affected = cy.nodes().filter((n) => hit.has(byLabel.get(n.id()) ?? ""));
      const self = cy.$id(selected.node.id);
      affected.removeClass("faded").addClass("impact");
      self.removeClass("faded");
      affected.union(self).parents().removeClass("faded");
      affected.edgesWith(affected.union(self)).removeClass("faded").addClass("hl-in");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selected?.node.id],
  );

  const jump = (id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.focusNode?.(id);
    cy.animate({ center: { eles: cy.$id(id) } }, { duration: 300 });
  };

  function runSearch(text: string) {
    const q = text.trim().toLowerCase();
    if (!q || !data || !cyRef.current) return;
    const hit =
      data.nodes.find((n) => n.label.toLowerCase() === q) ??
      data.nodes.find((n) => basename(n.label).toLowerCase().startsWith(q)) ??
      data.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (!hit) return;
    const cy = cyRef.current;
    cy.focusNode?.(hit.id);
    cy.animate({ center: { eles: cy.$id(hit.id) }, zoom: 1.4 }, { duration: 350 });
  }

  const toggles: { key: keyof GraphFilters; label: string }[] = [
    { key: "tests", label: "Tests" },
    { key: "other", label: "Docs & examples" },
    ...(isCall ? [] : [{ key: "external" as const, label: "External packages" }]),
  ];

  return (
    <div className="relative">
      <GraphGuide
        id={graphType}
        steps={copy.guide}
        layers={layersPresent}
        extra={
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-subtle">
            {!isCall && (
              <span>
                <span className="text-amber-700">★</span> start here
              </span>
            )}
            {!isCall && <span>◆ external package</span>}
            <span>┅ dashed box = {isCall ? "one file" : "one module"}</span>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <form
          className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5 focus-within:border-accent/50"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <Search size={13} className="text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list={`nodes-${graphType}`}
            placeholder={isCall ? "Find a function…" : "Find a file…"}
            aria-label="Search the graph"
            className="w-40 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
          />
          <datalist id={`nodes-${graphType}`}>
            {(data?.nodes ?? []).slice(0, 400).map((n) => (
              <option key={n.id} value={n.label} />
            ))}
          </datalist>
        </form>
        <Segmented
          label="Layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "grouped", label: "Grouped" },
            { value: "flow", label: "Top-down flow" },
          ]}
        />
        <Segmented
          label="Colour"
          value={colorBy}
          onChange={setColorBy}
          options={[
            { value: "layer", label: "Role" },
            { value: "module", label: isCall ? "File" : "Module" },
          ]}
        />
        {toggles.map((t) => (
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
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Show
          <select
            value={filters.limit}
            onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value) }))}
            className="rounded-md border border-line bg-sunken px-1.5 py-1 text-xs text-fg focus:outline-none"
            aria-label="Maximum nodes"
          >
            {[50, 80, 150, 250, 400, 800].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => cyRef.current?.fit(undefined, 30)}
          className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          <Maximize2 size={12} /> Fit
        </button>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-subtle">
          {isFetching && <Loader2 size={12} className="animate-spin" />}
          {data && `${data.nodes.length} ${copy.noun} · ${data.edges.length} links`}
          {data?.truncated && <span className="text-warn">· most-connected shown</span>}
        </span>
      </div>

      {isLoading ? (
        <div className="flex h-[620px] items-center justify-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Laying out the graph…
        </div>
      ) : error ? (
        <p className="p-6 text-red-600">Couldn’t load the graph.</p>
      ) : !data || data.nodes.length === 0 ? (
        <p className="p-6 text-sm text-muted">
          {isCall
            ? "No call relationships found in the product code. Calls are resolved best-effort for JS/TS and Python."
            : "No import relationships found in the product code with the current filters."}
        </p>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-[620px] w-full bg-canvas-dim" />
          <GraphTip tip={tip} />
      {selected && (
        <div className="absolute right-3 top-3 max-h-[590px] w-80 overflow-y-auto rounded-lg border border-line bg-surface/95 p-3.5 shadow-lift backdrop-blur">
          <button
            onClick={() => {
              cyRef.current?.elements().removeClass("faded hl hl-in impact").unselect();
              setSelected(null);
            }}
            className="float-right text-subtle hover:text-fg"
            aria-label="Close details"
          >
            <X size={14} />
          </button>
          <div className="text-[10px] uppercase tracking-wide text-subtle">
            {selected.node.type === "file" ? "File" : selected.node.type === "symbol" ? "Function" : "External package"}
            {selected.node.entry && <span className="ml-1.5 normal-case tracking-normal text-amber-700">★ a good place to start</span>}
          </div>
          <div className="mt-1 break-all font-mono text-[12.5px] text-fg">
            {selected.node.type === "symbol" ? `${selected.node.label}()` : selected.node.label}
          </div>
          {selected.node.file && (
            <div className="mt-1 break-all font-mono text-[11px] text-muted">
              defined in {selected.node.file}
              {selected.node.line ? `:${selected.node.line}` : ""}
            </div>
          )}
          {selected.node.type === "symbol" && selected.node.layer && (
            <div className="mt-1.5 text-[11.5px]" style={{ color: layerColor(selected.node.layer) }}>
              {selected.node.layer} — {LAYER_HINT[selected.node.layer]}
            </div>
          )}
          {selected.node.type === "file" && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="imported by*" value={selected.node.fanIn ?? selected.in.length} />
              <Metric label="imports*" value={selected.node.fanOut ?? selected.out.length} />
              <Metric label="hotspot" value={selected.node.hotspotScore ?? 0} />
            </div>
          )}
          {selected.node.type === "file" && (
            <p className="mt-1 text-[10px] text-subtle">* across the whole repo, including tests; the lists below show files in view.</p>
          )}
          {selected.node.type === "file" && (
            <FileInsight key={selected.node.id} jobId={jobId} path={selected.node.label} onImpact={showImpact} />
          )}
          {selected.node.type !== "external_package" && (
            <NeighbourList title={copy.out} tone="text-accent-soft" items={selected.out} onPick={jump} />
          )}
          <NeighbourList title={copy.in} tone="text-warn" items={selected.in} onPick={jump} />
          <p className="mt-3 text-[11px] text-subtle">Click a name to move there. Click empty space to reset.</p>
        </div>
      )}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            value === o.value ? "bg-black/[0.07] text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NeighbourList({
  title,
  tone,
  items,
  onPick,
}: {
  title: string;
  tone: string;
  items: Neighbour[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className={`text-[10px] uppercase tracking-wide ${tone}`}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-subtle">none shown</p>
      ) : (
        <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => onPick(n.id)}
                className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-black/[0.04]"
              >
                <span className="truncate font-mono text-[11.5px] text-fg">{n.label}</span>
                {n.sub && <span className="truncate font-mono text-[10px] text-subtle">{n.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-sunken px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-subtle">{label}</div>
      <div className="font-mono text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}
