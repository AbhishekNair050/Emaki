import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph, parse } from '@emaki/format';
import { layoutGraph, type GraphEdgeIn, type LaidOutNode } from '../src/map/layout.ts';

const demoSrc = readFileSync(fileURLToPath(new URL('../../../games/gullwing/story.vn', import.meta.url)), 'utf8');

function demoLayout() {
  const g = buildGraph(parse(demoSrc).program);
  return layoutGraph(g.nodes.map((n) => n.label), g.edges, 'arrival');
}

const byId = (nodes: LaidOutNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe('story map layout', () => {
  it('puts each scene below the scene that leads to it', () => {
    const n = byId(demoLayout().nodes);
    expect(n.get('arrival')!.layer).toBe(0);
    expect(n.get('kitchen_talk')!.layer).toBe(1);
    expect(n.get('lamp_room_trouble')!.layer).toBe(2);
    expect(n.get('the_long_night')!.layer).toBe(3);
    for (const e of ['ending_two_keepers', 'ending_light_holds', 'ending_rough_water']) {
      expect(n.get(e)!.layer).toBe(4);
    }
  });

  it('never overlaps nodes and keeps everything inside the canvas', () => {
    const l = demoLayout();
    for (const a of l.nodes) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(l.width);
      expect(a.y + a.h).toBeLessThanOrEqual(l.height);
      for (const b of l.nodes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('merges parallel edges and keeps every reason', () => {
    const l = demoLayout();
    const crank = l.edges.filter((e) => e.from === 'lamp_room_trouble' && e.to === 'crank_the_lamp');
    expect(crank).toHaveLength(1);
    expect(crank[0].via).toHaveLength(2);
    expect(crank[0].kind).toBe('call');
  });

  it('detects loops as back edges and routes them around the side', () => {
    const edges: GraphEdgeIn[] = [
      { from: 'a', to: 'b', kind: 'jump', via: null },
      { from: 'b', to: 'c', kind: 'jump', via: null },
      { from: 'c', to: 'a', kind: 'choice', via: 'Try again' },
    ];
    const l = layoutGraph(['a', 'b', 'c'], edges, 'a');
    const back = l.edges.find((e) => e.from === 'c')!;
    expect(back.back).toBe(true);
    expect(l.edges.filter((e) => e.back)).toHaveLength(1);
    const n = byId(l.nodes);
    expect([n.get('a')!.layer, n.get('b')!.layer, n.get('c')!.layer]).toEqual([0, 1, 2]);
    const rightmostNode = Math.max(...l.nodes.map((x) => x.x + x.w));
    expect(back.mid.x).toBeGreaterThan(rightmostNode);
  });

  it('marks scenes that cannot be reached from the start', () => {
    const l = layoutGraph(['start', 'orphan'], [], 'start');
    expect(byId(l.nodes).get('orphan')!.unreachable).toBe(true);
    expect(byId(l.nodes).get('start')!.unreachable).toBe(false);
  });

  it('orders rows to avoid crossings', () => {
    // s leads to b first, so DFS discovers b, y before a, x. Whatever order the
    // rows end up in, a/b and x/y must match, or the two edges would cross.
    const edges: GraphEdgeIn[] = [
      { from: 's', to: 'b', kind: 'jump', via: null },
      { from: 's', to: 'a', kind: 'jump', via: null },
      { from: 'a', to: 'x', kind: 'jump', via: null },
      { from: 'b', to: 'y', kind: 'jump', via: null },
    ];
    const n = byId(layoutGraph(['s', 'a', 'b', 'x', 'y'], edges, 's').nodes);
    const sameOrder = (n.get('a')!.x < n.get('b')!.x) === (n.get('x')!.x < n.get('y')!.x);
    expect(sameOrder).toBe(true);
  });

  it('can run left to right: each scene to the right of the one that leads to it, nothing overlapping', () => {
    const g = buildGraph(parse(demoSrc).program);
    const l = layoutGraph(g.nodes.map((n) => n.label), g.edges, 'arrival', { direction: 'right', nodeWidth: 160, nodeHeight: 70 });
    const n = byId(l.nodes);
    expect(n.get('kitchen_talk')!.x).toBeGreaterThan(n.get('arrival')!.x + 160);
    expect(n.get('kitchen_talk')!.y).toBe(n.get('arrival')!.y);
    for (const a of l.nodes) {
      expect(a.x + a.w).toBeLessThanOrEqual(l.width);
      expect(a.y + a.h).toBeLessThanOrEqual(l.height);
      for (const b of l.nodes) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    // A forward edge leaves the right side of its scene and enters the left side of the next.
    const e = l.edges.find((x) => x.from === 'arrival' && x.to === 'kitchen_talk')!;
    expect(e.path.startsWith(`M${n.get('arrival')!.x + 160} `)).toBe(true);
  });
});

