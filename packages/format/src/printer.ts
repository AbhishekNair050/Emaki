/**
 * Printer: AST -> canonical `.vn` source.
 *
 * This is the foundation of the visual editor round-trip: the flowchart view
 * edits the AST, and the printer writes it back as clean, diff-friendly text,
 * keeping every comment and paragraph break the writer made.
 *
 * Invariants (tested):
 *  - parse(print(ast)) is structurally equal to ast
 *  - print(parse(text)) === text for any text already in canonical form
 *
 * Canonical spacing: one blank line between the header, each group of
 * declarations (characters, images, audio, variables) and each label. Inside
 * blocks, blank lines are kept where the writer put them (collapsed to one).
 */
import { printLayerProps } from './layers.ts';
import type { AssetRef, Program, Stmt, Trivia } from './ast.ts';
import { printExpr } from './expr.ts';
import { printScreenLine, type ScreenItem } from './screens.ts';
import { printPluginCall } from './plugins.ts';
import { splitComment } from './parser.ts';

const INDENT = '  ';

export function print(program: Program): string {
  const out: string[] = [];
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  if (program.meta.length) {
    out.push('---');
    program.meta.forEach(([k, v], i) => {
      const t = program.metaTrivia?.[i];
      for (const c of t?.leading ?? []) if (c) out.push(c);
      out.push(`${k}: ${v}${tail(t)}`);
    });
    for (const c of program.metaTrailing ?? []) out.push(c);
    out.push('---');
  }

  const sections: Array<Array<Trivia & { text: string }>> = [
    program.characters.map((c) => ({ ...c, text: `define ${c.id} ${q(c.name)}${c.color ? ` color=${c.color}` : ''}` })),
    program.images.map((i) => ({ ...i, text: `image ${i.name} = ${q(i.path)}${i.gallery ? ' gallery' : ''}` })),
    program.audio.map((a) => ({ ...a, text: `audio ${a.name} = ${q(a.path)}${a.music !== undefined ? ` music ${q(a.music)}` : ''}` })),
    program.vars.map((v) => ({ ...v, text: `${v.global ? 'global ' : ''}var ${v.name} = ${printExpr(v.init)}` })),
    program.achievements.map((a) => ({ ...a, text: `achievement ${a.id} ${q(a.name)}` })),
    program.endings.map((e) => ({ ...e, text: `ending ${e.id} ${q(e.name)}` })),
    (program.replays ?? []).map((r) => ({ ...r, text: [`replay ${r.label} ${q(r.name)}`, r.image ? `image ${r.image}` : '', r.until ? `until ${r.until}` : ''].filter(Boolean).join(' ') })),
  ];
  for (const section of sections) {
    if (!section.length) continue;
    blank();
    for (const item of section) {
      trivia(item.leading, '', out);
      out.push(item.text + tail(item));
    }
  }

  for (const l of program.layered) {
    blank();
    trivia(l.leading, '', out);
    out.push(`layered ${l.tag}:${tail(l)}`);
    for (const layer of l.layers) {
      trivia(layer.leading, INDENT, out);
      if (layer.kind === 'always') { out.push(`${INDENT}always ${q(layer.path)}${tail(layer)}`); continue; }
      out.push(`${INDENT}group ${layer.name}${layer.optional ? ' optional' : ''}:${tail(layer)}`);
      for (const o of layer.options) {
        trivia(o.leading, INDENT + INDENT, out);
        out.push(`${INDENT}${INDENT}${o.attr} ${q(o.path)}${tail(o)}`);
      }
    }
  }

  for (const a of program.animations ?? []) {
    blank();
    trivia(a.leading, '', out);
    out.push(`animation ${a.name}${a.loop ? ' loop' : ''}:${tail(a)}`);
    for (const k of a.keys) {
      trivia(k.leading, INDENT, out);
      out.push(INDENT + [String(k.time), ...printLayerProps(k.props), k.ease ? `ease ${k.ease}` : ''].filter(Boolean).join(' ') + tail(k));
    }
  }

  for (const sc of program.screens) {
    blank();
    trivia(sc.leading, '', out);
    const tr = sc.transition ? ` with ${sc.transition.name}${sc.transition.duration !== undefined ? ` ${sc.transition.duration}` : ''}` : '';
    out.push(`screen ${sc.name}${tr}:${tail(sc)}`);
    const items = (list: ScreenItem[], depth: number) => {
      for (const it of list) {
        trivia(it.leading, INDENT.repeat(depth), out);
        out.push(INDENT.repeat(depth) + printScreenLine(it) + tail(it));
        if (it.children) items(it.children, depth + 1);
      }
    };
    items(sc.items, 1);
  }

  for (const l of program.labels) {
    blank();
    trivia(l.leading, '', out);
    out.push(`label ${l.name}:${tail(l)}`);
    printBlock(l.body, 1, out);
  }

  if (program.trailing?.length) {
    blank();
    trivia(program.trailing, '', out);
  }

  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

/** A node's end-of-line comment, as written after its line. */
function tail(n: Trivia | undefined): string {
  return n?.comment ? `  ${n.comment}` : '';
}

/** Emit comments and blank lines above a node. */
function trivia(leading: string[] | undefined, pad: string, out: string[]): void {
  for (const t of leading ?? []) {
    if (t === '') {
      if (out.length && out[out.length - 1] !== '') out.push('');
    } else out.push(pad + t);
  }
}

function printBlock(stmts: Stmt[], depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const s of stmts) {
    trivia(s.leading, pad, out);
    // The statement's own line is the first one it writes (`menu:`, an `if` line).
    const own = out.length;
    switch (s.type) {
      case 'say': {
        if (s.who === null) out.push(pad + q(s.text));
        else {
          const who = [s.who, ...s.attrs].join(' ');
          // Quote dialogue only when it would otherwise be ambiguous.
          const needsQuotes = s.text.startsWith('"') || s.text !== s.text.trim() || s.text.includes('\n')
            || splitComment(s.text).comment !== undefined; // ` # ` would read back as a comment
          out.push(`${pad}${who}: ${needsQuotes ? q(s.text) : s.text}`);
        }
        break;
      }
      case 'scene':
        out.push(pad + ['scene', s.image, withT(s.transition, s.duration)].filter(Boolean).join(' '));
        break;
      case 'show':
        out.push(pad + ['show', s.tag, ...s.attrs, s.as ? `as ${s.as}` : '', s.at ? `at ${s.at}` : '', ...printLayerProps(s.props ?? {}), withT(s.transition, s.duration)].filter(Boolean).join(' '));
        break;
      case 'animate':
        if (s.animation !== undefined) out.push(pad + `animate ${s.target} ${s.animation === null ? 'stop' : `with ${s.animation}`}`);
        else out.push(pad + ['animate', s.target, ...printLayerProps(s.props), `over ${s.over}`, s.ease ? `ease ${s.ease}` : ''].filter(Boolean).join(' '));
        break;
      case 'with':
        out.push(pad + withT(s.transition, s.duration));
        break;
      case 'hide':
        out.push(pad + ['hide', s.tag, withT(s.transition, s.duration)].filter(Boolean).join(' '));
        break;
      case 'play':
        out.push(pad + [
          'play', s.channel, asset(s.asset),
          s.loop === null ? '' : s.loop ? 'loop' : 'noloop',
          s.fade === null ? '' : `fade ${s.fade}`,
        ].filter(Boolean).join(' '));
        break;
      case 'stop':
        out.push(pad + ['stop', s.channel, s.fade === null ? '' : `fade ${s.fade}`].filter(Boolean).join(' '));
        break;
      case 'set':
        out.push(`${pad}set ${s.name} ${s.op} ${printExpr(s.expr)}`);
        break;
      case 'jump': case 'call':
        out.push(`${pad}${s.type} ${s.target}`);
        break;
      case 'return':
        out.push(pad + s.type);
        break;
      case 'end':
        out.push(pad + (s.ending ? `end ${s.ending}` : 'end'));
        break;
      case 'wait':
        out.push(`${pad}wait ${s.seconds}`);
        break;
      case 'achieve':
        out.push(`${pad}achieve ${s.id}`);
        break;
      case 'nvl':
        out.push(`${pad}nvl ${s.mode}`);
        break;
      case 'shake':
        out.push(pad + ['shake', s.duration].filter((x) => x !== undefined).join(' '));
        break;
      case 'motion':
        out.push(pad + [s.motion, s.target, s.times, s.forever && s.motion !== 'float' ? 'forever' : undefined].filter((x) => x !== undefined).join(' '));
        break;
      case 'still':
        out.push(`${pad}still ${s.target}`);
        break;
      case 'tone':
        out.push(pad + ['tone', s.tone, s.over !== null ? `over ${s.over}` : ''].filter(Boolean).join(' '));
        break;
      case 'movie':
        out.push(`${pad}movie ${q(s.path)}`);
        break;
      case 'screen':
        out.push(`${pad}${s.mode} screen ${s.name}${s.into ? ` -> ${s.into}` : ''}`);
        break;
      case 'plugin':
        out.push(`${pad}${printPluginCall(s.call)}${s.into ? ` -> ${s.into}` : ''}`);
        break;
      case 'flash':
        out.push(pad + ['flash', s.color, s.duration].filter((x) => x !== undefined && x !== null).join(' '));
        break;
      case 'camera':
        out.push(pad + [
          'camera', s.zoom === null ? 'reset' : `zoom ${s.zoom}`,
          s.at ? `at ${s.at[0]}% ${s.at[1]}%` : '',
          s.over !== null ? `over ${s.over}` : '',
        ].filter(Boolean).join(' '));
        break;
      case 'menu':
        out.push(`${pad}menu:`);
        for (const c of s.choices) {
          trivia(c.leading, pad + INDENT, out);
          out.push(`${pad}${INDENT}${q(c.text)}${c.cond ? ` if ${printExpr(c.cond)}` : ''}:${tail(c)}`);
          printBlock(c.body, depth + 2, out);
        }
        break;
      case 'if':
        s.branches.forEach((b, i) => {
          if (i > 0) trivia(b.leading, pad, out);
          if (b.cond === null) out.push(`${pad}else:${i > 0 ? tail(b) : ''}`);
          else out.push(`${pad}${i === 0 ? 'if' : 'elif'} ${printExpr(b.cond)}:${i > 0 ? tail(b) : ''}`);
          printBlock(b.body, depth + 1, out);
        });
        break;
    }
    if (s.comment && out[own] !== undefined) out[own] += tail(s);
  }
}

function withT(t: string | null, duration?: number): string {
  return t ? `with ${t}${duration !== undefined ? ` ${duration}` : ''}` : '';
}

function asset(a: AssetRef): string {
  return a.kind === 'name' ? a.name : q(a.path);
}

function q(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}
