/**
 * Layered flowchart layout for story graphs (a small Sugiyama-style pass).
 *
 *  1. Classify edges: a DFS from the start label marks edges that loop back
 *     as "back" edges; everything else forms a DAG.
 *  2. Layering: each label sits one row below its deepest predecessor.
 *  3. Ordering: barycenter sweeps reduce edge crossings within rows.
 *  4. Geometry: rows top-to-bottom, nodes centred, edges as cubic curves
 *     (back edges curve around the right-hand side).
 *
 * Pure and DOM-free, so the editor can reuse it and tests run in Node.
 */

export interface GraphEdgeIn {
  from: string;
  to: string;
  kind: 'jump' | 'call' | 'choice';
  via: string | null;
}

export interface LaidOutNode {
  id: string;
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Not reachable from the start label. */
  unreachable: boolean;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  kind: GraphEdgeIn['kind'];
  /** Every choice/condition that leads along this edge (merged duplicates). */
  via: string[];
  back: boolean;
  /** SVG path data. */
  path: string;
  /** Midpoint, for placing a label. */
  mid: { x: number; y: number };
}

export interface MapLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  rowGap?: number;
  colGap?: number;
  margin?: number;
}

export function layoutGraph(ids: string[], edgesIn: GraphEdgeIn[], start: string, opts: LayoutOptions = {}): MapLayout {
  const W = opts.nodeWidth ?? 156;
  const H = opts.nodeHeight ?? 46;
  const ROW = opts.rowGap ?? 64;
  const COL = opts.colGap ?? 22;
  const M = opts.margin ?? 20;

  const known = new Set(ids);
  // Merge duplicate edges (e.g. two choices leading to the same label).
  const merged = new Map<string, { from: string; to: string; kind: GraphEdgeIn['kind']; via: string[]; back: boolean }>();
  for (const e of edgesIn) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    const key = `${e.from}\u0000${e.to}\u0000${e.kind}`;
    const m = merged.get(key) ?? { from: e.from, to: e.to, kind: e.kind, via: [], back: false };
    if (e.via) m.via.push(e.via);
    merged.set(key, m);
  }
  const edges = [...merged.values()];
  const out = new Map<string, typeof edges>();
  for (const id of ids) out.set(id, []);
  for (const e of edges) out.get(e.from)!.push(e);

  // 1. DFS: discovery order + back-edge classification.
  const state = new Map<string, 0 | 1 | 2>();
  const discovery: string[] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    discovery.push(u);
    for (const e of out.get(u)!) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) e.back = true;
      else if (s === 0) visit(e.to);
    }
    state.set(u, 2);
  };
  const roots = known.has(start) ? [start, ...ids.filter((i) => i !== start)] : ids;
  const reachable = new Set<string>();
  if (known.has(start)) {
    visit(start);
    discovery.forEach((d) => reachable.add(d));
  }
  for (const r of roots) if (!state.get(r)) visit(r);

  // 2. Longest-path layering over the DAG (Kahn's algorithm).
  const dag = edges.filter((e) => !e.back);
  // Each label's DAG edges in and out, in edge order (a full-length game has thousands).
  const dagIn = new Map<string, typeof edges>(ids.map((i) => [i, []]));
  const dagOut = new Map<string, typeof edges>(ids.map((i) => [i, []]));
  for (const e of dag) { dagIn.get(e.to)!.push(e); dagOut.get(e.from)!.push(e); }
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const e of dag) indeg.set(e.to, indeg.get(e.to)! + 1);
  const layer = new Map(ids.map((i) => [i, 0]));
  const queue = discovery.filter((i) => indeg.get(i) === 0);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q]!;
    for (const e of dagOut.get(u)!) {
      layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(u)! + 1));
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }

  // 3. Rows, ordered by discovery, then barycenter sweeps.
  const rowCount = Math.max(0, ...layer.values()) + 1;
  const rows: string[][] = Array.from({ length: rowCount }, () => []);
  for (const id of discovery) rows[layer.get(id)!].push(id);
  // Each label's place in its row (0..1), kept up to date as rows are sorted.
  const p = new Map<string, number>();
  const place = (r: string[]) => r.forEach((id, i) => p.set(id, (i + 0.5) / r.length));
  rows.forEach(place);
  const sortBy = (row: string[], score: (id: string) => number | null) => {
    const current = new Map(row.map((id, i) => [id, i]));
    const scores = new Map(row.map((id) => [id, score(id) ?? current.get(id)! / row.length]));
    row.sort((a, b) => scores.get(a)! - scores.get(b)! || current.get(a)! - current.get(b)!);
    place(row);
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let i = 1; i < rowCount; i++) {
      sortBy(rows[i], (id) => avg(dagIn.get(id)!.map((e) => p.get(e.from)!)));
    }
    for (let i = rowCount - 2; i >= 0; i--) {
      sortBy(rows[i], (id) => avg(dagOut.get(id)!.map((e) => p.get(e.to)!)));
    }
  }

  // 4. Geometry.
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const hasBack = edges.some((e) => e.back);
  const backRoom = hasBack ? 56 : 0;
  const width = M * 2 + widest * W + (widest - 1) * COL + backRoom;
  const height = M * 2 + rowCount * H + (rowCount - 1) * ROW;
  const nodes = new Map<string, LaidOutNode>();
  rows.forEach((r, li) => {
    const rowWidth = r.length * W + (r.length - 1) * COL;
    const x0 = (width - backRoom - rowWidth) / 2;
    r.forEach((id, i) => nodes.set(id, {
      id,
      layer: li,
      x: x0 + i * (W + COL),
      y: M + li * (H + ROW),
      w: W,
      h: H,
      unreachable: known.has(start) && !reachable.has(id),
    }));
  });

  let backIndex = 0;
  const laidEdges: LaidOutEdge[] = edges.map((e) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    let p0, p1, p2, p3;
    if (e.from === e.to) {
      p0 = { x: a.x + a.w, y: a.y + a.h * 0.3 };
      p3 = { x: a.x + a.w, y: a.y + a.h * 0.7 };
      p1 = { x: p0.x + 40, y: p0.y - 16 };
      p2 = { x: p3.x + 40, y: p3.y + 16 };
    } else if (e.back || b.layer <= a.layer) {
      const bulge = 36 + 10 * backIndex++;
      p0 = { x: a.x + a.w, y: a.y + a.h / 2 };
      p3 = { x: b.x + b.w, y: b.y + b.h / 2 };
      const right = Math.max(p0.x, p3.x) + bulge;
      p1 = { x: right, y: p0.y };
      p2 = { x: right, y: p3.y };
    } else {
      p0 = { x: a.x + a.w / 2, y: a.y + a.h };
      p3 = { x: b.x + b.w / 2, y: b.y };
      const dy = (p3.y - p0.y) / 2;
      p1 = { x: p0.x, y: p0.y + dy };
      p2 = { x: p3.x, y: p3.y - dy };
    }
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      from: e.from,
      to: e.to,
      kind: e.kind,
      via: e.via,
      back: e.back,
      path: `M${r(p0.x)} ${r(p0.y)} C${r(p1.x)} ${r(p1.y)} ${r(p2.x)} ${r(p2.y)} ${r(p3.x)} ${r(p3.y)}`,
      mid: { x: r((p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8), y: r((p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8) },
    };
  });

  return { nodes: ids.map((id) => nodes.get(id)!), edges: laidEdges, width, height };
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
