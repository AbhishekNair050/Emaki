/**
 * Plugins: code a game ships in plugins/<name>/ (index.js) for what the
 * script language doesn't do, described by a manifest (plugin.json) so the
 * compiler can check every use without running the plugin.
 *
 *   @petals on amount=40 color="pink"      a command (effects, lasting state)
 *   @cards play rounds=3 -> score          a command the story waits on, with a result
 *   screen hud:
 *     @clock face style="digital" at 90% 4%  an element on a screen
 *   if @dice.roll(6) > 4:                   a function, in any expression
 *
 * Arguments are always named (`key=value`); a value is a number, a quoted
 * string, true/false, a variable, or any expression written without spaces.
 */
import type { Loc } from './ast.ts';
import { freeVars, parseExpr, pluginCalls, printExpr, readQuoted, type Expr, type Value } from './expr.ts';

/** An argument's type: a kind (`?` = may be left out), or the strings it may be. */
export type PluginArgType = 'number' | 'string' | 'boolean' | 'number?' | 'string?' | 'boolean?' | string[];

export interface PluginCommandSpec {
  args?: Record<string, PluginArgType>;
  /** The story waits until the command finishes (a minigame, a quiz); `-> var` keeps its result. */
  waits?: boolean;
  /**
   * The command's effect lasts (snow keeps falling): it's part of the saved
   * game under this slot, so loading or going back brings it back. Commands
   * sharing a slot replace each other.
   */
  lasting?: string;
  /** Clears its `lasting` slot (snow stops). */
  ends?: boolean;
  /** What it does, for the editor. */
  description?: string;
}

export interface PluginElementSpec {
  args?: Record<string, PluginArgType>;
  description?: string;
}

/**
 * A function for expressions: `@dice.roll(6)`. Arguments are given in the
 * order they're declared (optional ones last). It answers straight away and
 * shouldn't change anything the story can see: what it returns is what
 * counts, kept in a variable when the story needs it again.
 */
export interface PluginFunctionSpec {
  args?: Record<string, PluginArgType>;
  returns?: 'number' | 'string' | 'boolean';
  description?: string;
}

export interface PluginManifest {
  name: string;
  description?: string;
  /** The code, relative to the plugin's folder (index.js by default). */
  main?: string;
  commands?: Record<string, PluginCommandSpec>;
  elements?: Record<string, PluginElementSpec>;
  functions?: Record<string, PluginFunctionSpec>;
  /**
   * The story variables the plugin may change (`ctx.set`): a battle's hit
   * points, a shop's gold. The compiler checks they're declared.
   */
  sets?: string[];
}

export const PLUGIN_NAME = /^[a-z][a-z0-9_]*$/;
const ARG_KINDS = ['number', 'string', 'boolean', 'number?', 'string?', 'boolean?'];

/** Check a plugin.json (already JSON-parsed) for the plugin in folder `name`. */
export function parseManifest(raw: unknown, name: string): { manifest: PluginManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!PLUGIN_NAME.test(name)) errors.push(`A plugin's folder name must be lowercase letters, digits and _ (it's what @${name} would be written as)`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, errors: [...errors, 'plugin.json should be an object'] };
  const r = raw as Record<string, unknown>;
  const ident = /^[A-Za-z_]\w*$/;
  const args = (where: string, a: unknown): Record<string, PluginArgType> | undefined => {
    if (a === undefined) return undefined;
    if (!a || typeof a !== 'object' || Array.isArray(a)) { errors.push(`${where}: "args" should map argument names to types`); return undefined; }
    const out: Record<string, PluginArgType> = {};
    for (const [k, t] of Object.entries(a)) {
      if (!ident.test(k)) errors.push(`${where}: '${k}' isn't a valid argument name`);
      else if (typeof t === 'string' && ARG_KINDS.includes(t)) out[k] = t as PluginArgType;
      else if (Array.isArray(t) && t.length && t.every((x) => typeof x === 'string')) out[k] = t as string[];
      else errors.push(`${where}: argument '${k}' should be "number", "string", "boolean" (with ? if it can be left out), or a list of strings`);
    }
    return out;
  };
  const table = <T>(key: 'commands' | 'elements' | 'functions', one: (n: string, v: Record<string, unknown>) => T): Record<string, T> | undefined => {
    const v = r[key];
    if (v === undefined) return undefined;
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`"${key}" should be an object`); return undefined; }
    const out: Record<string, T> = {};
    for (const [n, spec] of Object.entries(v)) {
      if (!ident.test(n)) { errors.push(`${key}: '${n}' isn't a valid name`); continue; }
      out[n] = one(n, spec && typeof spec === 'object' ? spec as Record<string, unknown> : {});
    }
    return out;
  };
  const manifest: PluginManifest = {
    name,
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    ...(typeof r.main === 'string' ? { main: r.main } : {}),
  };
  const commands = table('commands', (n, s) => {
    const c: PluginCommandSpec = {};
    const a = args(`command '${n}'`, s.args);
    if (a) c.args = a;
    if (s.waits === true) c.waits = true;
    if (typeof s.lasting === 'string') c.lasting = s.lasting;
    if (s.ends === true) {
      if (!c.lasting) errors.push(`command '${n}': "ends" needs the "lasting" slot it ends`);
      c.ends = true;
    }
    if (c.waits && c.lasting) errors.push(`command '${n}': a command the story waits on can't also last`);
    if (typeof s.description === 'string') c.description = s.description;
    return c;
  });
  if (commands) manifest.commands = commands;
  const elements = table('elements', (n, s) => {
    const e: PluginElementSpec = {};
    const a = args(`element '${n}'`, s.args);
    if (a) e.args = a;
    if (typeof s.description === 'string') e.description = s.description;
    return e;
  });
  if (elements) manifest.elements = elements;
  const functions = table('functions', (n, s) => {
    const f: PluginFunctionSpec = {};
    const a = args(`function '${n}'`, s.args);
    if (a) {
      f.args = a;
      const optional = Object.values(a).map((t) => typeof t === 'string' && t.endsWith('?'));
      if (optional.some((o, i) => o && optional.slice(i + 1).some((later) => !later))) {
        errors.push(`function '${n}': arguments are given in order, so the ones that can be left out (?) go last`);
      }
    }
    if (s.returns !== undefined) {
      if (s.returns === 'number' || s.returns === 'string' || s.returns === 'boolean') f.returns = s.returns;
      else errors.push(`function '${n}': "returns" should be "number", "string" or "boolean"`);
    }
    if (typeof s.description === 'string') f.description = s.description;
    return f;
  });
  if (functions) manifest.functions = functions;
  if (r.sets !== undefined) {
    if (!Array.isArray(r.sets) || !r.sets.every((v) => typeof v === 'string')) errors.push('"sets" should be a list of variable names, like ["hp", "gold"]');
    else {
      for (const v of r.sets) if (!ident.test(v)) errors.push(`sets: '${v}' isn't a valid variable name`);
      if (r.sets.length) manifest.sets = [...new Set(r.sets as string[])];
    }
  }
  if (!manifest.commands && !manifest.elements && !manifest.functions && !manifest.sets) errors.push('plugin.json declares no "commands", "elements", "functions" or "sets"');
  return { manifest: errors.length ? null : manifest, errors };
}

/** `@petals on amount=40` → its parts; `rest` is what follows the arguments (a screen element's layout). */
export interface PluginCall {
  plugin: string;
  /** The command or element. */
  name: string;
  args: Record<string, Expr>;
}

/**
 * Read `@plugin name key=value ...` from the start of `src`. Stops at the
 * first word that isn't `key=value`; returns the rest, or a message for the
 * writer.
 */
export function parsePluginCall(src: string): { call: PluginCall; rest: string } | { error: string } {
  const m = /^@([A-Za-z_]\w*)(?:\s+([A-Za-z_]\w*))?/.exec(src);
  if (!m) return { error: `Expected '@plugin command', like '@petals on'` };
  if (!m[2]) return { error: `'@${m[1]}' needs a command after it, like '@${m[1]} on'` };
  const call: PluginCall = { plugin: m[1]!, name: m[2], args: {} };
  let i = m[0].length;
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    const k = /^([A-Za-z_]\w*)=/.exec(src.slice(i));
    if (!k) break;
    i += k[0].length;
    let value: string;
    if (src[i] === '"') {
      try {
        const q = readQuoted(src, i);
        value = src.slice(i, q.end);
        i = q.end;
      } catch (e) {
        return { error: (e as Error).message };
      }
    } else {
      const start = i;
      while (i < src.length && !/\s/.test(src[i]!)) i++;
      value = src.slice(start, i);
    }
    if (!value) return { error: `'${k[1]}=' needs a value` };
    if (call.args[k[1]!]) return { error: `'${k[1]}' is given twice` };
    try {
      call.args[k[1]!] = parseExpr(value);
    } catch (e) {
      return { error: `${k[1]}=${value}: ${(e as Error).message}` };
    }
  }
  return { call, rest: src.slice(i).trim() };
}

export function printPluginCall(c: PluginCall): string {
  return [`@${c.plugin}`, c.name, ...Object.entries(c.args).map(([k, v]) => `${k}=${argText(v)}`)].join(' ');
}

/**
 * An argument value with no spaces outside quotes, so it reads back as one
 * value: `x + 1` prints as `x+1`. (Values are read up to the next space, so
 * they can't hold `and`/`or`/`not`; a variable does that job.)
 */
function argText(e: Expr): string {
  const s = printExpr(e);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') { const q = readQuoted(s, i); out += s.slice(i, q.end); i = q.end - 1; continue; }
    if (s[i] !== ' ') out += s[i];
  }
  return out;
}

/**
 * Check a call against the plugins' manifests: the plugin, the command or
 * element, and each argument (literal values against their type, variables
 * against the story's). `plugins` undefined means the manifests aren't known
 * here (a lone script in an editor): nothing is checked.
 */
export function checkPluginCall(
  c: PluginCall, kind: 'command' | 'element', plugins: Readonly<Record<string, PluginManifest>> | undefined,
  knownVar: (name: string) => boolean, report: (code: string, message: string) => void,
): PluginCommandSpec | PluginElementSpec | null {
  for (const e of Object.values(c.args)) {
    for (const v of freeVars(e)) if (!knownVar(v)) report('unknown-variable', `Unknown variable '${v}'`);
    checkPluginFunctions(e, plugins, report);
  }
  if (!plugins) return null;
  const p = plugins[c.plugin];
  if (!p) {
    report('unknown-plugin', `No plugin '${c.plugin}' (plugins go in plugins/${c.plugin}/ with a plugin.json)${Object.keys(plugins).length ? `; this game has: ${Object.keys(plugins).join(', ')}` : ''}`);
    return null;
  }
  const table = kind === 'command' ? p.commands : p.elements;
  const spec = table?.[c.name];
  if (!spec) {
    const have = Object.keys(table ?? {});
    report(`unknown-plugin-${kind}`, `'${c.plugin}' has no ${kind} '${c.name}'${have.length ? ` (it has: ${have.join(', ')})` : ''}`);
    return null;
  }
  const declared = spec.args ?? {};
  for (const [k, e] of Object.entries(c.args)) {
    const t = declared[k];
    if (!t) { report('bad-plugin-arg', `@${c.plugin} ${c.name} has no '${k}'${Object.keys(declared).length ? ` (it takes: ${Object.keys(declared).join(', ')})` : ''}`); continue; }
    const problem = argProblem(t, e);
    if (problem) report('bad-plugin-arg', `'${k}' should be ${problem}`);
  }
  for (const [k, t] of Object.entries(declared)) {
    if (!(k in c.args) && !(typeof t === 'string' && t.endsWith('?'))) report('bad-plugin-arg', `@${c.plugin} ${c.name} needs '${k}=...'`);
  }
  return spec;
}

/** What a literal argument should have been, or null when it fits (or isn't a literal: that's checked when it runs). */
function argProblem(t: PluginArgType, e: Expr): string | null {
  const literal: Value | undefined = e.k === 'num' || e.k === 'str' || e.k === 'bool' ? e.v : undefined;
  if (literal === undefined) return null;
  return Array.isArray(t)
    ? (typeof literal === 'string' && t.includes(literal) ? null : `one of ${t.map((x) => `"${x}"`).join(', ')}`)
    : (typeof literal === t.replace('?', '') ? null : `a ${t.replace('?', '')}`);
}

/**
 * Check the plugin functions an expression calls: the plugin, the function,
 * how many arguments, and literal ones against their types. `plugins`
 * undefined: not known here, nothing checked.
 */
export function checkPluginFunctions(
  e: Expr, plugins: Readonly<Record<string, PluginManifest>> | undefined, report: (code: string, message: string) => void,
): void {
  if (!plugins) return;
  for (const c of pluginCalls(e)) {
    const p = plugins[c.plugin];
    if (!p) {
      report('unknown-plugin', `No plugin '${c.plugin}' (plugins go in plugins/${c.plugin}/ with a plugin.json)${Object.keys(plugins).length ? `; this game has: ${Object.keys(plugins).join(', ')}` : ''}`);
      continue;
    }
    const spec = p.functions?.[c.fn];
    if (!spec) {
      const have = Object.keys(p.functions ?? {});
      report('unknown-plugin-function', `'${c.plugin}' has no function '${c.fn}'${have.length ? ` (it has: ${have.join(', ')})` : ''}`);
      continue;
    }
    const declared = Object.entries(spec.args ?? {});
    const needed = declared.filter(([, t]) => !(typeof t === 'string' && t.endsWith('?'))).length;
    const usage = `@${c.plugin}.${c.fn}(${declared.map(([k, t]) => (typeof t === 'string' && t.endsWith('?') ? `${k}?` : k)).join(', ')})`;
    if (c.args.length < needed || c.args.length > declared.length) {
      report('bad-plugin-arg', `${usage} takes ${needed === declared.length ? declared.length : `${needed} to ${declared.length}`} argument${declared.length === 1 ? '' : 's'}, not ${c.args.length}`);
      continue;
    }
    c.args.forEach((a, i) => {
      const [k, t] = declared[i]!;
      const problem = argProblem(t, a);
      if (problem) report('bad-plugin-arg', `${usage}: '${k}' should be ${problem}`);
    });
  }
}

export type { Loc };
