export interface LEdge {
  source: string;
  target: string;
  weight?: number;
}

export type Positions = Record<string, { x: number; y: number }>;

/**
 * Dependency depth for each node: 0 = foundation (uses nothing shown), higher = built on top.
 * Cycles are common (modules import each other), so each pair keeps its dominant direction
 * and the remaining back-edges found by DFS are ignored.
 */
export function dependencyRanks(ids: string[], edges: LEdge[]): Map<string, number> {
  const known = new Set(ids);
  const wt = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target) || e.source === e.target) continue;
    const m = wt.get(e.source) ?? new Map<string, number>();
    m.set(e.target, (m.get(e.target) ?? 0) + (e.weight ?? 1));
    wt.set(e.source, m);
  }
  const out = new Map(ids.map((i) => [i, new Set<string>()]));
  for (const [s, m] of wt) {
    for (const [t, w] of m) {
      const back = wt.get(t)?.get(s) ?? 0;
      if (w > back || (w === back && s < t)) out.get(s)!.add(t);
    }
  }
  const state = new Map<string, number>();
  const dfs = (v: string) => {
    state.set(v, 1);
    for (const u of [...out.get(v)!]) {
      const st = state.get(u) ?? 0;
      if (st === 1) out.get(v)!.delete(u);
      else if (st === 0) dfs(u);
    }
    state.set(v, 2);
  };
  ids.forEach((v) => !state.get(v) && dfs(v));

  const rank = new Map<string, number>();
  const visit = (v: string): number => {
    const r = rank.get(v);
    if (r !== undefined) return r;
    let m = 0;
    for (const u of out.get(v)!) m = Math.max(m, visit(u) + 1);
    rank.set(v, m);
    return m;
  };
  ids.forEach(visit);
  return rank;
}

/**
 * Place rows top-to-bottom. Each row is ordered by the mean x of already-placed neighbours
 * (fewer crossings) and wrapped when wider than `maxWidth`.
 */
export function placeRows(
  rows: string[][],
  edges: LEdge[],
  opts: { width?: (id: string) => number; gapX?: number; rowGap?: number; maxWidth?: number; startY?: number } = {},
): { pos: Positions; rowY: number[]; endY: number } {
  const width = opts.width ?? (() => 40);
  const gapX = opts.gapX ?? 40;
  const rowGap = opts.rowGap ?? 110;
  const maxWidth = opts.maxWidth ?? 1600;
  const nb = new Map<string, string[]>();
  for (const e of edges) {
    nb.set(e.source, [...(nb.get(e.source) ?? []), e.target]);
    nb.set(e.target, [...(nb.get(e.target) ?? []), e.source]);
  }
  const pos: Positions = {};
  const rowY: number[] = [];
  let y = opts.startY ?? 0;
  for (const row of rows) {
    rowY.push(y);
    const bary = (v: string) => {
      const xs = (nb.get(v) ?? []).map((u) => pos[u]?.x).filter((x): x is number => x !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const sorted = [...row].sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    // wrap into sub-rows
    const lines: string[][] = [[]];
    let lineW = 0;
    for (const v of sorted) {
      const w = width(v) + gapX;
      if (lineW + w > maxWidth && lines[lines.length - 1].length) {
        lines.push([]);
        lineW = 0;
      }
      lines[lines.length - 1].push(v);
      lineW += w;
    }
    for (const line of lines) {
      const total = line.reduce((s, v) => s + width(v), 0) + gapX * (line.length - 1);
      let x = -total / 2;
      for (const v of line) {
        pos[v] = { x: x + width(v) / 2, y };
        x += width(v) + gapX;
      }
      y += rowGap * (lines.length > 1 ? 0.7 : 1);
    }
    if (lines.length > 1) y += rowGap * 0.3;
  }
  return { pos, rowY, endY: y };
}

/**
 * Deterministic "module boxes" layout: groups are stacked in rows by dependency depth
 * (groups built on top first, foundations last); members of a group sit in a compact grid,
 * importers before the files they import.
 */
export function groupedPositions(
  groups: Map<string, string[]>,
  edges: LEdge[],
  opts: { cellW?: number; cellH?: number; gapX?: number; gapY?: number; maxWidth?: number } = {},
): Positions {
  const cellW = opts.cellW ?? 110;
  const cellH = opts.cellH ?? 58;
  const gapX = opts.gapX ?? 70;
  const gapY = opts.gapY ?? 90;
  const maxWidth = opts.maxWidth ?? 2200;

  const groupOf = new Map<string, string>();
  for (const [g, ids] of groups) for (const id of ids) groupOf.set(id, g);
  const degree = new Map<string, number>();
  const groupEdges: LEdge[] = [];
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    const a = groupOf.get(e.source);
    const b = groupOf.get(e.target);
    if (a && b && a !== b) groupEdges.push({ source: a, target: b, weight: e.weight ?? 1 });
  }

  // grid inside each group
  const local = new Map<string, { cols: number; rows: number; order: string[] }>();
  for (const [g, ids] of groups) {
    const inner = edges.filter((e) => groupOf.get(e.source) === g && groupOf.get(e.target) === g);
    const rank = dependencyRanks(ids, inner);
    const order = [...ids].sort(
      (a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0) || (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
    );
    const cols = Math.max(1, Math.min(order.length, Math.ceil(Math.sqrt(order.length * 1.8))));
    local.set(g, { cols, rows: Math.ceil(order.length / cols), order });
  }
  const gw = (g: string) => local.get(g)!.cols * cellW;
  const gh = (g: string) => local.get(g)!.rows * cellH;

  // rows of groups by dependency depth, wrapped when too wide
  const names = [...groups.keys()];
  const rank = dependencyRanks(names, groupEdges);
  const max = Math.max(0, ...rank.values());
  const rows: string[][] = [];
  for (let r = max; r >= 0; r--) {
    const row = names.filter((g) => rank.get(g) === r).sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
    let line: string[] = [];
    let w = 0;
    for (const g of row) {
      if (line.length && w + gw(g) + gapX > maxWidth) {
        rows.push(line);
        line = [];
        w = 0;
      }
      line.push(g);
      w += gw(g) + gapX;
    }
    if (line.length) rows.push(line);
  }

  const pos: Positions = {};
  let y = 0;
  for (const row of rows) {
    const total = row.reduce((s, g) => s + gw(g), 0) + gapX * (row.length - 1);
    let x = -total / 2;
    for (const g of row) {
      const { cols, order } = local.get(g)!;
      order.forEach((id, i) => {
        pos[id] = { x: x + (i % cols) * cellW + cellW / 2, y: y + Math.floor(i / cols) * cellH + cellH / 2 };
      });
      x += gw(g) + gapX;
    }
    y += Math.max(...row.map(gh)) + gapY;
  }
  return pos;
}
