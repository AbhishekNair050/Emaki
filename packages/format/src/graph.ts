/**
 * Story graph: which labels lead to which, and how.
 *
 * Used by the CLI (`emaki graph` -> Mermaid) today, and by the editor's
 * flowchart view later.
 */
import type { Program, Stmt } from './ast.ts';
import { printExpr } from './expr.ts';

export type EdgeKind = 'jump' | 'call' | 'choice';

export interface StoryEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Choice text and/or condition that leads here, if any. */
  via: string | null;
  line: number;
  /** The file the jump is in, when it isn't story.vn. */
  file?: string;
}

export interface StoryNode {
  label: string;
  line: number;
  /** The script file, when it isn't story.vn. */
  file?: string;
  lines: number;
  /** Ends the story (contains `end`, or falls off without jumping anywhere). */
  ending: boolean;
}

export interface StoryGraph {
  nodes: StoryNode[];
  edges: StoryEdge[];
}

export function buildGraph(program: Program): StoryGraph {
  const nodes: StoryNode[] = [];
  const edges: StoryEdge[] = [];

  for (const l of program.labels) {
    let lines = 0;
    let hasEnd = false;
    const walk = (stmts: Stmt[], via: string[]) => {
      for (const s of stmts) {
        switch (s.type) {
          case 'say': lines++; break;
          case 'end': hasEnd = true; break;
          case 'jump': case 'call':
            edges.push({ from: l.name, to: s.target, kind: via.length && s.type === 'jump' ? 'choice' : s.type, via: via.length ? via.join(' / ') : null, line: s.loc.line, ...(s.loc.file ? { file: s.loc.file } : {}) });
            break;
          case 'menu':
            for (const c of s.choices) walk(c.body, [...via, c.text + (c.cond ? ` [${printExpr(c.cond)}]` : '')]);
            break;
          case 'if':
            for (const b of s.branches) walk(b.body, [...via, b.cond ? `if ${printExpr(b.cond)}` : 'else']);
            break;
          default: break;
        }
      }
    };
    walk(l.body, []);
    const last = l.body[l.body.length - 1];
    const fallsOff = last?.type !== 'jump' && !edges.some((e) => e.from === l.name && e.kind !== 'call');
    nodes.push({ label: l.name, line: l.loc.line, ...(l.loc.file ? { file: l.loc.file } : {}), lines, ending: hasEnd || fallsOff });
  }

  // Labels entered via `call` are subroutines: falling off the end returns
  // to the caller rather than ending the story.
  const called = new Set(edges.filter((e) => e.kind === 'call').map((e) => e.to));
  for (const n of nodes) {
    if (called.has(n.label) && !hasExplicitEnd(program, n.label)) n.ending = false;
  }

  return { nodes, edges };
}

function hasExplicitEnd(program: Program, label: string): boolean {
  const walk = (stmts: Stmt[]): boolean => stmts.some((s) =>
    s.type === 'end' ||
    (s.type === 'menu' && s.choices.some((c) => walk(c.body))) ||
    (s.type === 'if' && s.branches.some((b) => walk(b.body))));
  const l = program.labels.find((x) => x.name === label);
  return l ? walk(l.body) : false;
}

/** Render a graph as a Mermaid flowchart. */
export function toMermaid(g: StoryGraph): string {
  const id = (s: string) => `L_${s}`;
  const esc = (s: string) => s.replace(/"/g, "'");
  const out = ['flowchart TD'];
  for (const n of g.nodes) {
    const text = `${n.label}<br/><small>${n.lines} lines</small>`;
    out.push(n.ending ? `  ${id(n.label)}(["${esc(text)}"])` : `  ${id(n.label)}["${esc(text)}"]`);
  }
  for (const e of g.edges) {
    const arrow = e.kind === 'call' ? '-.->' : '-->';
    out.push(e.via ? `  ${id(e.from)} ${arrow}|"${esc(e.via)}"| ${id(e.to)}` : `  ${id(e.from)} ${arrow} ${id(e.to)}`);
  }
  return out.join('\n') + '\n';
}
