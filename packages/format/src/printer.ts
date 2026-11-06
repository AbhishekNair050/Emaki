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
import type { AssetRef, Program, Stmt, Trivia } from './ast.ts';
import { printExpr } from './expr.ts';

const INDENT = '  ';

export function print(program: Program): string {
  const out: string[] = [];
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  if (program.meta.length) {
    out.push('---');
    for (const [k, v] of program.meta) out.push(`${k}: ${v}`);
    out.push('---');
  }

  const sections: Array<Array<Trivia & { text: string }>> = [
    program.characters.map((c) => ({ leading: c.leading, text: `define ${c.id} ${q(c.name)}${c.color ? ` color=${c.color}` : ''}` })),
    program.images.map((i) => ({ leading: i.leading, text: `image ${i.name} = ${q(i.path)}${i.gallery ? ' gallery' : ''}` })),
    program.audio.map((a) => ({ leading: a.leading, text: `audio ${a.name} = ${q(a.path)}` })),
    program.vars.map((v) => ({ leading: v.leading, text: `${v.global ? 'global ' : ''}var ${v.name} = ${printExpr(v.init)}` })),
    program.achievements.map((a) => ({ leading: a.leading, text: `achievement ${a.id} ${q(a.name)}` })),
    program.endings.map((e) => ({ leading: e.leading, text: `ending ${e.id} ${q(e.name)}` })),
  ];
  for (const section of sections) {
    if (!section.length) continue;
    blank();
    for (const item of section) {
      trivia(item.leading, '', out);
      out.push(item.text);
    }
  }

  for (const l of program.layered) {
    blank();
    trivia(l.leading, '', out);
    out.push(`layered ${l.tag}:`);
    for (const layer of l.layers) {
      trivia(layer.leading, INDENT, out);
      if (layer.kind === 'always') { out.push(`${INDENT}always ${q(layer.path)}`); continue; }
      out.push(`${INDENT}group ${layer.name}${layer.optional ? ' optional' : ''}:`);
      for (const o of layer.options) {
        trivia(o.leading, INDENT + INDENT, out);
        out.push(`${INDENT}${INDENT}${o.attr} ${q(o.path)}`);
      }
    }
  }

  for (const l of program.labels) {
    blank();
    trivia(l.leading, '', out);
    out.push(`label ${l.name}:`);
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
    switch (s.type) {
      case 'say': {
        if (s.who === null) out.push(pad + q(s.text));
        else {
          const who = [s.who, ...s.attrs].join(' ');
          // Quote dialogue only when it would otherwise be ambiguous.
          const needsQuotes = s.text.startsWith('"') || s.text !== s.text.trim() || s.text.includes('\n');
          out.push(`${pad}${who}: ${needsQuotes ? q(s.text) : s.text}`);
        }
        break;
      }
      case 'scene':
        out.push(pad + ['scene', s.image, withT(s.transition, s.duration)].filter(Boolean).join(' '));
        break;
      case 'show':
        out.push(pad + ['show', s.tag, ...s.attrs, s.at ? `at ${s.at}` : '', withT(s.transition, s.duration)].filter(Boolean).join(' '));
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
          out.push(`${pad}${INDENT}${q(c.text)}${c.cond ? ` if ${printExpr(c.cond)}` : ''}:`);
          printBlock(c.body, depth + 2, out);
        }
        break;
      case 'if':
        s.branches.forEach((b, i) => {
          if (i > 0) trivia(b.leading, pad, out);
          if (b.cond === null) out.push(`${pad}else:`);
          else out.push(`${pad}${i === 0 ? 'if' : 'elif'} ${printExpr(b.cond)}:`);
          printBlock(b.body, depth + 1, out);
        });
        break;
    }
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
