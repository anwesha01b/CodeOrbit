import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import { Boxes, Download, FileCode2, GitFork, Loader2, Maximize2, Route, X } from "lucide-react";
import type { GraphEdgeDTO, GraphNodeDTO, Layer } from "@codeorbit/shared";
import { fetchGraph, type GraphFilters } from "../lib/api";
import { colorFor, basename, layerColor, LAYER_HINT } from "../lib/graphColors";
import { dependencyRanks, groupedPositions, placeRows } from "../lib/layered";
import { explainFile, explainFunction } from "../lib/explain";
import { FileInsight } from "./FileInsight";
import { GraphGuide, GraphTip, type TipState } from "./GraphGuide";
import { Crumbs, GraphError, Meaning, SearchBox, ToolButton, ViewBanner, exportPng, useGraphKeys, zoomLabels, type SearchItem } from "./GraphParts";
import { useOpenCode } from "./CodeDrawer";

type Mode = "dependency" | "call";
type LayoutMode = "grouped" | "flow";
type ColorMode = "layer" | "module";
type Dir = "both" | "down" | "up";
interface Trace {
  id: string;
  dir: Dir;
  depth: number;
}

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
  { selector: "node.labeled, node.hover, node.zl", style: { label: "data(short)", "font-size": 11 } },
  {
    selector: "node.entry",
    style: { shape: "star", width: 34, height: 34, "border-width": 1.5, "border-color": "#18181b", label: "data(short)", "font-size": 12, color: "#18181b" },
  },
  { selector: 'node[type="external_package"]', style: { shape: "round-diamond", "background-color": "#a1a1aa" } },
  { selector: "node.outside", style: { opacity: 0.45 } },
  { selector: "node.root", style: { "border-width": 3, "border-color": "#18181b", width: 30, height: 30, "font-size": 13, color: "#18181b", "z-index": 25 } },
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
      width: "mapData(weight, 1, 6, 0.8, 2.4)",
      "line-color": "rgba(82,82,91,0.22)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(82,82,91,0.4)",
      "arrow-scale": 0.6,
    },
  },
  { selector: "edge.trace", style: { "line-color": "rgba(82,82,91,0.5)", "target-arrow-color": "rgba(82,82,91,0.7)", width: 1.4 } },
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
      <>A <b className="text-fg">★ star</b> marks the best places to start reading. Zoom in to see every file name.</>,
      <>Click a file, then <b className="text-fg">Trace</b> to see only what it uses (below) and what uses it (above).</>,
    ],
    out: "Imports",
    in: "Imported by",
    down: "Uses",
    up: "Used by",
    noun: "files",
    unit: "file",
  },
  call: {
    guide: [
      <>Each dot is a <b className="text-fg">function or method</b>. In “Grouped”, boxes hold the functions of one file.</>,
      <>An arrow <span className="font-mono">A → B</span> means A calls B. In “Top-down flow”, callers sit above what they call.</>,
      <>Click a function, then <b className="text-fg">Trace</b> to follow what happens when it runs, step by step downward.</>,
      <>Calls across files are matched by name, so a few links can be approximate.</>,
    ],
    out: "Calls",
    in: "Called by",
    down: "Calls",
    up: "Callers",
    noun: "functions",
    unit: "function",
  },
};

/**
 * Shortest chain between two nodes: following arrows from a to b, else from b to a, else ignoring
 * direction. Returns the node ids in order (empty when they are not connected).
 */
function shortestPath(a: string, b: string, edges: GraphEdgeDTO[]): { ids: string[]; how: "forward" | "backward" | "mixed" } {
  const bfs = (from: string, to: string, adj: Map<string, string[]>) => {
    const prev = new Map<string, string>([[from, from]]);
    const queue = [from];
    while (queue.length) {
      const v = queue.shift()!;
      if (v === to) break;
      for (const u of adj.get(v) ?? []) {
        if (!prev.has(u)) {
          prev.set(u, v);
          queue.push(u);
        }
      }
    }
    if (!prev.has(to)) return null;
    const chain = [to];
    while (chain[0] !== from) chain.unshift(prev.get(chain[0])!);
    return chain;
  };
  const out = new Map<string, string[]>();
  const both = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    both.set(e.source, [...(both.get(e.source) ?? []), e.target]);
    both.set(e.target, [...(both.get(e.target) ?? []), e.source]);
  }
  const f = bfs(a, b, out);
  if (f) return { ids: f, how: "forward" };
  const r = bfs(b, a, out);
  if (r) return { ids: r, how: "backward" };
  return { ids: bfs(a, b, both) ?? [], how: "mixed" };
}

/** Stable, shareable key for a node: a file path, or file:line for a function. */
function nodeKey(n: GraphNodeDTO): string {
  return n.type === "symbol" && n.file ? `${n.file}:${n.line ?? 0}` : n.label;
}

/** Nodes reachable from `root` within `depth` steps, with their level (−n above = callers/importers, +n below). */
function traceLevels(root: string, edges: GraphEdgeDTO[], dir: Dir, depth: number): Map<string, number> {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    inc.set(e.target, [...(inc.get(e.target) ?? []), e.source]);
  }
  const level = new Map<string, number>([[root, 0]]);
  const walk = (adj: Map<string, string[]>, sign: 1 | -1) => {
    let frontier = [root];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: string[] = [];
      for (const v of frontier) {
        for (const u of adj.get(v) ?? []) {
          if (level.has(u)) continue;
          level.set(u, sign * d);
          next.push(u);
        }
      }
      frontier = next;
    }
  };
  if (dir !== "up") walk(out, 1);
  if (dir !== "down") walk(inc, -1);
  return level;
}

export function DependencyView({ jobId, graphType = "dependency" }: { jobId: string; graphType?: Mode }) {
  const isCall = graphType === "call";
  const copy = COPY[graphType];
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") ?? "";
  const [filters, setFilters] = useState<GraphFilters>({ limit: isCall ? 80 : 250 });
  // a whole call graph reads best as a flow; one file's functions read best as a grid
  const [layout, setLayout] = useState<LayoutMode>(isCall && !scope ? "flow" : "grouped");
  useEffect(() => {
    if (scope) setLayout("grouped");
  }, [scope]);
  const [colorBy, setColorBy] = useState<ColorMode>("layer");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [traceDir, setTraceDir] = useState<Dir>(isCall ? "down" : "both");
  const [traceDepth, setTraceDepth] = useState(2);
  const [tip, setTip] = useState<TipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Cy | null>(null);
  const pendingFocus = useRef<string | null>(params.get("focus"));
  const pathRef = useRef<HTMLInputElement>(null);
  const openCode = useOpenCode();

  // scoped and traced views ask for every node, so nothing in the module or the trace is cut off
  const wantsAll = !!scope || params.has("trace") || params.has("path");
  const effective = useMemo(() => (wantsAll ? { ...filters, limit: 1500 } : filters), [filters, wantsAll]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["graph", jobId, graphType, effective],
    queryFn: () => fetchGraph(jobId, graphType, effective),
    enabled: !!jobId,
    placeholderData: keepPreviousData,
  });

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  // a trace lives in the URL (?trace=<file or file:line>&dir=down&depth=2) so it can be shared
  const trace = useMemo<Trace | null>(() => {
    const key = params.get("trace");
    if (!key || !data) return null;
    const node = data.nodes.find((n) => nodeKey(n) === key);
    if (!node) return null;
    const d = params.get("dir");
    const dir: Dir = d === "up" || d === "down" ? d : "both";
    const depth = Math.min(3, Math.max(1, Number(params.get("depth")) || 2));
    return { id: node.id, dir, depth };
  }, [params, data]);
  /** callers/importers and callees/imports counted over the whole loaded graph, for the explanations */
  const fullDegree = useMemo(() => {
    const inn = new Map<string, number>();
    const out = new Map<string, number>();
    for (const e of data?.edges ?? []) {
      out.set(e.source, (out.get(e.source) ?? 0) + 1);
      inn.set(e.target, (inn.get(e.target) ?? 0) + 1);
    }
    return { inn, out };
  }, [data]);

  // "how does A connect to B?" lives in the URL too (?path=<key>~<key>)
  const path = useMemo(() => {
    const raw = params.get("path");
    if (!raw || !data) return null;
    const [ka, kb] = raw.split("~");
    const a = data.nodes.find((n) => nodeKey(n) === ka);
    const b = data.nodes.find((n) => nodeKey(n) === kb);
    if (!a || !b) return null;
    return { a, b, ...shortestPath(a.id, b.id, data.edges) };
  }, [params, data]);

  /** what is on the canvas: everything, one module/file plus its neighbours, a trace, or a path */
  const view = useMemo(() => {
    if (!data) return null;
    if (path && path.ids.length) {
      const ids = new Set(path.ids);
      const level = new Map(path.ids.map((id, i) => [id, i]));
      return {
        nodes: path.ids.map((id) => byId.get(id)!).filter(Boolean),
        edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target),
        outside: new Set<string>(),
        level,
      };
    }
    if (trace && byId.has(trace.id)) {
      const level = traceLevels(trace.id, data.edges, trace.dir, trace.depth);
      const ids = new Set(level.keys());
      return {
        nodes: data.nodes.filter((n) => ids.has(n.id)),
        edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target),
        outside: new Set<string>(),
        level,
      };
    }
    if (scope) {
      const inside = new Set(data.nodes.filter((n) => n.clusterId === scope).map((n) => n.id));
      const near = new Set<string>();
      for (const e of data.edges) {
        if (inside.has(e.source) && !inside.has(e.target)) near.add(e.target);
        if (inside.has(e.target) && !inside.has(e.source)) near.add(e.source);
      }
      const ids = new Set([...inside, ...near]);
      return {
        nodes: data.nodes.filter((n) => ids.has(n.id)),
        edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
        outside: near,
        level: null,
        insideCount: inside.size,
      };
    }
    return { nodes: data.nodes, edges: data.edges, outside: new Set<string>(), level: null };
  }, [data, byId, trace, scope, path]);

  const layersPresent = useMemo(
    () => [...new Set((view?.nodes ?? []).filter((n) => n.layer).map((n) => n.layer!))] as Layer[],
    [view],
  );

  useEffect(() => {
    if (!view || !containerRef.current || view.nodes.length === 0) return;
    const { nodes, edges, outside, level } = view;
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const top = new Set(
      level
        ? nodes.map((n) => n.id) // a trace is small: label everything
        : [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, LABELED_TOP).map((n) => n.id),
    );
    const grouped = layout === "grouped" && !level;
    const groupKey = (n: GraphNodeDTO) => (n.type === "external_package" ? null : n.clusterId);
    const groups = new Map<string, GraphNodeDTO[]>();
    if (grouped) {
      for (const n of nodes) {
        const k = groupKey(n);
        if (k) groups.set(k, [...(groups.get(k) ?? []), n]);
      }
    }
    const nodeColor = (n: GraphNodeDTO) =>
      n.type === "external_package" ? "#a1a1aa" : colorBy === "layer" ? layerColor(n.layer) : colorFor(n.clusterId);

    const elements: ElementDefinition[] = [
      ...[...groups].map(([k, members]) => ({
        data: { id: `grp:${k}`, short: isCall ? basename(k) : k, color: colorBy === "layer" ? layerColor(members[0].layer) : colorFor(k) },
        classes: "group",
        selectable: false,
      })),
      ...nodes.map((n) => {
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
          classes: [
            top.has(n.id) ? "labeled" : "",
            n.entry ? "entry" : "",
            outside.has(n.id) ? "outside" : "",
            level && level.get(n.id) === 0 ? "root" : "",
          ]
            .join(" ")
            .trim(),
        };
      }),
      ...edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, weight: e.weight }, classes: level ? "trace" : "" })),
    ];

    // wrap rows to the canvas: a phone gets more, shorter rows instead of one tiny wide band
    const canvasW = containerRef.current.clientWidth || 1200;
    const rowMax = (desktop: number) => Math.min(desktop, Math.max(560, canvasW * 1.6));
    let positions: Record<string, { x: number; y: number }>;
    if (level) {
      // callers/importers above the chosen node, what it calls/imports below
      const levels = [...new Set(level.values())].sort((a, b) => a - b);
      positions = placeRows(
        levels.map((l) => nodes.filter((n) => level.get(n.id) === l).map((n) => n.id)),
        edges,
        { width: () => 150, gapX: 24, rowGap: 110, maxWidth: rowMax(1500) },
      ).pos;
    } else if (grouped) {
      const boxes = new Map([...groups].map(([k, ns]) => [k, ns.map((n) => n.id)]));
      const loose = nodes.filter((n) => !groupKey(n)).map((n) => n.id);
      if (loose.length) boxes.set("\u0001loose", loose);
      positions = groupedPositions(boxes, edges, isCall ? { cellW: 120, cellH: 54 } : {});
    } else {
      const ids = nodes.map((n) => n.id);
      const rank = dependencyRanks(ids, edges);
      const max = Math.max(0, ...rank.values());
      const rows: string[][] = [];
      for (let r = max; r >= 0; r--) rows.push(ids.filter((id) => rank.get(id) === r));
      positions = placeRows(rows.filter((r) => r.length), edges, {
        width: (id) => (top.has(id) ? 90 : 34),
        gapX: 22,
        rowGap: 95,
        maxWidth: rowMax(1900),
      }).pos;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: STYLE,
      layout: { name: "preset", positions, fit: true, padding: 36 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.25,
      minZoom: 0.05,
      maxZoom: 3,
    }) as Cy;
    // a small view (short path, tiny trace) shouldn't blow up to giant dots
    if (cy.zoom() > 1.25) {
      cy.zoom(1.25);
      cy.center();
    }
    zoomLabels(cy);

    const describe = (id: string): Neighbour => {
      const n = byId.get(id);
      if (!n) return { id, label: id };
      if (n.type === "symbol") return { id, label: `${n.label}()`, sub: n.file ? `${basename(n.file)}${n.line ? `:${n.line}` : ""}` : undefined };
      if (n.type === "file") return { id, label: basename(n.label), sub: n.label.slice(0, n.label.lastIndexOf("/") + 1) };
      return { id, label: n.label, sub: "external package" };
    };
    /** select a node and colour its links; `fade` dims everything that isn't a direct neighbour */
    const focus = (id: string, fade = true) => {
      const node = cy.$id(id);
      if (node.empty()) return;
      cy.elements().removeClass("faded hl hl-in impact");
      if (fade) cy.elements().addClass("faded");
      const hood = node.closedNeighborhood();
      hood.removeClass("faded");
      hood.nodes().addClass("hl");
      hood.parents().removeClass("faded");
      node.outgoers("edge").addClass("hl");
      node.incomers("edge").addClass("hl-in");
      cy.$(":selected").unselect();
      node.select();
      const dto = byId.get(id);
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
      const n = byId.get(el.id());
      if (!n) return;
      const p = el.renderedPosition();
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
                ? `used by ${fullDegree.inn.get(n.id) ?? 0} files`
                : isCall
                  ? `called by ${fullDegree.inn.get(n.id) ?? 0} · calls ${fullDegree.out.get(n.id) ?? 0}`
                  : `imported by ${n.fanIn ?? 0} · imports ${n.fanOut ?? 0}`}
              {" · click for details"}
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

    // after a trace, keep its root selected; on first load, honour ?focus=
    const want =
      (level && trace?.id) ||
      (pendingFocus.current &&
        nodes.find((n) => n.label === pendingFocus.current || nodeKey(n) === pendingFocus.current)?.id);
    pendingFocus.current = null;
    if (want) {
      // a trace keeps every step visible; a plain deep link spotlights the node
      focus(want, !level);
      if (!level) cy.animate({ center: { eles: cy.$id(want) }, zoom: 1.3 }, { duration: 350 });
    }

    return () => {
      cy.destroy();
      cyRef.current = null;
      setSelected(null);
      setTip(null);
    };
    // trace is read through `view`; its id only picks the node to re-select
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, layout, colorBy, isCall, byId, fullDegree]);

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
      cy.elements().addClass("faded").removeClass("hl hl-in impact");
      const affected = cy.nodes().filter((n) => hit.has(byId.get(n.id())?.label ?? ""));
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

  /** keep the current tab, change only the given URL params */
  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };
  const exitScope = () => patchParams({ scope: null, focus: null });

  const searchRef = useRef<HTMLInputElement>(null);
  const searchItems = useMemo<SearchItem[]>(
    () =>
      (view?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.type === "symbol" ? `${n.label}()` : n.label,
        sub:
          n.type === "symbol"
            ? n.file
              ? `${basename(n.file)}:${n.line ?? ""}`
              : undefined
            : n.label.slice(0, n.label.lastIndexOf("/") + 1),
        kind: n.type === "symbol" ? "function" : n.type === "file" ? "file" : "package",
      })),
    [view],
  );
  const goToNode = (id: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.focusNode?.(id);
    cy.animate({ center: { eles: cy.$id(id) }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 350 });
  };
  useGraphKeys({
    search: () => searchRef.current?.focus(),
    reset: () => {
      cyRef.current?.elements().removeClass("faded hl hl-in impact").unselect();
      setSelected(null);
    },
    fit: () => cyRef.current?.fit(undefined, 30),
  });
  const exitPath = () => patchParams({ path: null });
  /** the chain in words: "app() calls handle(), which calls _match()" */
  const pathSentence = (() => {
    if (!path || !path.ids.length) return "";
    const name = (id: string) => {
      const n = byId.get(id);
      return n ? (n.type === "symbol" ? `${n.label}()` : basename(n.label)) : id;
    };
    const fwd = isCall ? "calls" : "imports";
    const back = isCall ? "is called by" : "is imported by";
    const has = new Set((data?.edges ?? []).map((e) => `${e.source}>${e.target}`));
    const hops = path.ids.slice(1).map((id, i) => {
      const verb = has.has(`${path.ids[i]}>${id}`) ? fwd : back;
      return `${i === 0 ? "" : "which "}${verb} ${name(id)}`;
    });
    return [name(path.ids[0]), hops.join(", ")].filter(Boolean).join(" ");
  })();

  const toggles: { key: keyof GraphFilters; label: string }[] = [
    { key: "tests", label: "Tests" },
    { key: "other", label: "Docs & examples" },
    ...(isCall ? [] : [{ key: "external" as const, label: "External packages" }]),
  ];

  const sel = selected?.node;
  const traceRoot = trace ? byId.get(trace.id) : undefined;

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
            <span>
              <span className="text-[#2563eb]">—</span> {copy.down.toLowerCase()} · <span className="text-[#c2410c]">—</span> {copy.up.toLowerCase()}
            </span>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <SearchBox items={searchItems} placeholder={isCall ? "Find a function…" : "Find a file…"} onPick={goToNode} inputRef={searchRef} />
        {!trace && (
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "grouped", label: "Grouped" },
              { value: "flow", label: "Top-down flow" },
            ]}
          />
        )}
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
              filters[t.key] ? "border-accent/50 bg-accent/15 text-accent-soft" : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
        {!wantsAll && (
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
        )}
        <ToolButton onClick={() => cyRef.current?.fit(undefined, 30)}>
          <Maximize2 size={12} aria-hidden /> Fit
        </ToolButton>
        <ToolButton onClick={() => exportPng(cyRef.current, `${graphType}-graph.png`)} label="Download the graph as a PNG image">
          <Download size={12} aria-hidden /> PNG
        </ToolButton>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-subtle">
          {isFetching && <Loader2 size={12} className="animate-spin" />}
          {view && `${view.nodes.length} ${copy.noun} · ${view.edges.length} links`}
          {data?.truncated && !wantsAll && <span className="text-warn">· most-connected shown</span>}
        </span>
      </div>

      {isLoading ? (
        <div className="flex h-[620px] items-center justify-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Laying out the graph…
        </div>
      ) : error ? (
        <GraphError what={isCall ? "call graph" : "dependency graph"} onRetry={() => refetch()} />
      ) : !view || view.nodes.length === 0 ? (
        <div className="p-6 text-sm text-muted">
          {scope ? (
            <>
              Nothing from <span className="font-mono text-fg">{scope}</span> appears in this graph.{" "}
              <button onClick={exitScope} className="font-medium text-fg underline underline-offset-2">
                Show everything
              </button>
            </>
          ) : isCall ? (
            "No call relationships found in the product code. Calls are resolved for JavaScript, TypeScript and Python."
          ) : (
            "No import relationships found in the product code with the current filters."
          )}
        </div>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-[620px] w-full bg-canvas-dim" />
          <GraphTip tip={tip} />

          {path ? (
            <ViewBanner onExit={exitPath} exitLabel="Exit path">
              {path.ids.length ? (
                <>
                  <span className="font-medium text-fg">
                    How they connect ({path.ids.length - 1} step{path.ids.length > 2 ? "s" : ""}):
                  </span>{" "}
                  <span className="font-mono text-[12px]">{pathSentence}</span>.
                </>
              ) : (
                <>
                  No connection found between <b className="font-mono font-medium text-fg">{basename(path.a.label)}</b> and{" "}
                  <b className="font-mono font-medium text-fg">{basename(path.b.label)}</b> in this graph.
                </>
              )}
            </ViewBanner>
          ) : trace && traceRoot ? (
            <ViewBanner onExit={() => patchParams({ trace: null, dir: null, depth: null })} exitLabel="Exit trace">
              Tracing <b className="font-mono font-medium text-fg">{traceRoot.type === "symbol" ? `${traceRoot.label}()` : basename(traceRoot.label)}</b>
              {", "}
              {trace.dir !== "down" && <>{copy.up.toLowerCase()} above</>}
              {trace.dir === "both" && " and "}
              {trace.dir !== "up" && <>{copy.down.toLowerCase()} below</>}, {trace.depth} step{trace.depth > 1 ? "s" : ""}: {view.nodes.length}{" "}
              {copy.noun}.
            </ViewBanner>
          ) : scope ? (
            <ViewBanner onExit={exitScope} exitLabel="Show everything">
              Showing <b className="font-mono font-medium text-fg">{scope}</b> ({view.insideCount ?? 0} {copy.noun}) and, faded, the{" "}
              {copy.noun} it connects to.{(view.insideCount ?? 0) > 25 && " Large: click one and use Trace to follow a single path."}
            </ViewBanner>
          ) : null}

          {sel && selected && (
            <aside
              aria-label="Details"
              className="relative m-3 rounded-lg border border-line bg-surface/95 p-3.5 shadow-lift backdrop-blur md:absolute md:right-3 md:top-3 md:m-0 md:max-h-[580px] md:w-80 md:overflow-y-auto"
            >
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
              <Crumbs
                items={
                  sel.type === "file"
                    ? [
                        ...(sel.layer ? [{ label: sel.layer }] : []),
                        ...(sel.clusterId
                          ? [{ label: sel.clusterId, mono: true, onClick: () => setParams({ tab: "architecture", focus: sel.clusterId! }) }]
                          : []),
                        { label: basename(sel.label), mono: true },
                      ]
                    : sel.type === "symbol" && sel.file
                      ? [
                          ...(sel.layer ? [{ label: sel.layer }] : []),
                          { label: basename(sel.file), mono: true, onClick: () => setParams({ tab: "deps", focus: sel.file! }) },
                          { label: `${sel.label}()`, mono: true },
                        ]
                      : [{ label: "External package" }, { label: sel.label, mono: true }]
                }
              />
              <div className="text-[10px] uppercase tracking-wide text-subtle">
                {sel.type === "file" ? "File" : sel.type === "symbol" ? "Function" : "External package"}
                {sel.entry && <span className="ml-1.5 normal-case tracking-normal text-amber-700">★ a good place to start</span>}
              </div>
              <div className="mt-1 break-all font-mono text-[12.5px] text-fg">{sel.type === "symbol" ? `${sel.label}()` : sel.label}</div>
              {sel.file && (
                <div className="mt-1 break-all font-mono text-[11px] text-muted">
                  defined in {sel.file}
                  {sel.line ? `:${sel.line}` : ""}
                </div>
              )}
              {sel.layer && (
                <div className="mt-1.5 text-[11.5px]" style={{ color: layerColor(sel.layer) }}>
                  {sel.layer}: {LAYER_HINT[sel.layer]}
                </div>
              )}
              {sel.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-fg-2">{sel.summary}</p>}
              {sel.type !== "external_package" && (
                <Meaning
                  lines={
                    sel.type === "file"
                      ? explainFile(sel)
                      : explainFunction(sel, fullDegree.inn.get(sel.id) ?? 0, fullDegree.out.get(sel.id) ?? 0)
                  }
                />
              )}

              {/* trace controls */}
              {sel.type !== "external_package" && (
                <div className="mt-3 rounded-md border border-line p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg">
                    <Route size={12} aria-hidden /> Trace from here
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Segmented
                      label="Direction"
                      value={traceDir}
                      onChange={setTraceDir}
                      options={[
                        { value: "down", label: copy.down },
                        { value: "up", label: copy.up },
                        { value: "both", label: "Both" },
                      ]}
                    />
                    <Segmented
                      label="Steps"
                      value={String(traceDepth) as "1" | "2" | "3"}
                      onChange={(v) => setTraceDepth(Number(v))}
                      options={[
                        { value: "1", label: "1" },
                        { value: "2", label: "2" },
                        { value: "3", label: "3" },
                      ]}
                    />
                  </div>
                  <button
                    onClick={() => patchParams({ trace: nodeKey(sel), dir: traceDir, depth: String(traceDepth), focus: null })}
                    className="btn-primary mt-2 h-8 w-full px-3 py-0 text-xs"
                  >
                    <Route size={13} aria-hidden /> Show trace
                  </button>
                </div>
              )}

              {sel.type !== "external_package" && (
                <button
                  onClick={() =>
                    sel.type === "symbol" && sel.file
                      ? openCode({ path: sel.file, line: sel.line, title: `${sel.label}()` })
                      : openCode({ path: sel.label })
                  }
                  className="btn-ghost mt-3 h-8 w-full px-3 py-0 text-xs"
                >
                  <FileCode2 size={13} aria-hidden /> Read the code
                </button>
              )}

              {/* how does it connect to another file or function? */}
              {sel.type !== "external_package" && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[11px] font-medium text-fg">How does it connect to…</div>
                  <SearchBox
                    items={searchItems.filter((i) => i.id !== sel.id)}
                    placeholder={isCall ? "another function" : "another file"}
                    inputRef={pathRef}
                    onPick={(id) => {
                      const target = byId.get(id);
                      if (target) patchParams({ path: `${nodeKey(sel)}~${nodeKey(target)}`, trace: null, focus: null });
                    }}
                  />
                </div>
              )}

              {/* links into the other views */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sel.type === "file" && (
                  <>
                    <LinkChip onClick={() => setParams({ tab: "call", scope: sel.label })} icon={GitFork}>
                      Its functions
                    </LinkChip>
                    {sel.clusterId && (
                      <LinkChip onClick={() => setParams({ tab: "architecture", focus: sel.clusterId! })} icon={Boxes}>
                        Its module
                      </LinkChip>
                    )}
                  </>
                )}
                {sel.type === "symbol" && sel.file && (
                  <>
                    <LinkChip onClick={() => setParams({ tab: "deps", focus: sel.file! })} icon={FileCode2}>
                      Its file’s imports
                    </LinkChip>
                    {scope !== sel.file && (
                      <LinkChip onClick={() => patchParams({ scope: sel.file!, focus: null })} icon={GitFork}>
                        Only this file
                      </LinkChip>
                    )}
                  </>
                )}
              </div>

              {sel.type === "file" && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Metric label="imported by" value={sel.fanIn ?? 0} />
                  <Metric label="imports" value={sel.fanOut ?? 0} />
                  <Metric label="hotspot" value={sel.hotspotScore ?? 0} />
                </div>
              )}
              {sel.type === "file" && <FileInsight key={sel.id} jobId={jobId} path={sel.label} onImpact={showImpact} />}
              {sel.type !== "external_package" && <NeighbourList title={copy.out} tone="text-[#2563eb]" items={selected.out} onPick={jump} />}
              <NeighbourList title={copy.in} tone="text-[#c2410c]" items={selected.in} onPick={jump} />
              <p className="mt-3 text-[11px] text-subtle">Lists show what is on screen. Click a name to move there; click empty space to reset.</p>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function LinkChip({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof Boxes; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
    >
      <Icon size={12} aria-hidden /> {children}
    </button>
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
          className={`rounded px-2 py-0.5 text-xs transition-colors ${value === o.value ? "bg-black/[0.07] text-fg" : "text-muted hover:text-fg"}`}
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
        <p className="mt-1 text-[11px] text-subtle">none on screen</p>
      ) : (
        <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button onClick={() => onPick(n.id)} className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-black/[0.04]">
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
