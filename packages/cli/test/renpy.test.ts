import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { compileGame } from '@emaki/format/files';
import { logicalLines, parseRpy } from '../src/renpy/lines.ts';
import { convertExpr, convertText, ident } from '../src/renpy/text.ts';
import { convertRenpy, type Assets } from '../src/renpy/convert.ts';
import { importRenpy } from '../src/renpy/import.ts';

sharp.cache(false);
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'emaki-renpy-')); scratch.push(d); return d; };

const noFiles: Assets = { exists: () => false, imageFiles: [] };
const convert = (src: string, assets: Assets = noFiles) => convertRenpy([{ path: 'script.rpy', lines: parseRpy(src) }], assets);
const script = (src: string, assets?: Assets) => convert(src, assets).files['scripts/script.vn'] ?? '';

describe('reading Ren\'Py scripts', () => {
  it('joins lines inside brackets and strings, and drops comments', () => {
    const lines = logicalLines(`label start:  # the start
    e "One line
       over two."
    $ x = max(1,
              2)
    "Not # a comment"
`);
    expect(lines.map((l) => [l.line, l.indent, l.text])).toEqual([
      [1, 0, 'label start:'],
      [2, 4, 'e "One line\n       over two."'],
      [4, 4, '$ x = max(1,               2)'],
      [6, 4, '"Not # a comment"'],
    ]);
    const tree = parseRpy('init:\n    define a = 1\nlabel x:\n    "hi"\n');
    expect(tree.map((l) => [l.text, l.block.length])).toEqual([['init:', 1], ['label x:', 1]]);
  });

  it('turns text tags and interpolation into Emaki styling', () => {
    expect(convertText('{i}Quiet{/i}, {b}loud{/b} [player]!').text).toBe('*Quiet*, **loud** {player}!');
    expect(convertText('Wait{w} for it{w=0.5}.{nw}').text).toBe('Wait[w] for it[w=0.5].[nw]');
    // Ren'Py doubles only `{`; Emaki doubles both.
    expect(convertText('{color=#f00}red{/color} {{braces} [[brackets]').text).toBe('[color=#f00]red[/color] {{braces}} \\[brackets\\]');
    expect(convertText('{rb}東京{/rb}{rt}とうきょう{/rt}').text).toBe('[ruby=とうきょう]東京[/ruby]');
    expect(convertText('5 * 3 # x').text).toBe('5 \\* 3 \\# x');
    const odd = convertText('{size=40}Big{/size} [persistent.name]');
    expect(odd.text).toBe('Big {persistent_name}');
    expect(odd.dropped).toEqual(['{size=40}', '{/size}']);
  });

  it('turns Python conditions into Emaki expressions, or says it can’t', () => {
    expect(convertExpr('points >= 3 and not met_her')?.expr).toBe('points >= 3 and not met_her');
    expect(convertExpr("persistent.ending == 'good' or flag == True")?.expr).toBe('persistent_ending == "good" or flag == true');
    expect(convertExpr('-1 < x')?.expr).toBe('-1 < x');
    expect(convertExpr('renpy.random.randint(1, 3) == 2')).toBeNull();
    expect(convertExpr('x is None')).toBeNull();
    expect(ident('1a')).toBe('_1a');
    expect(ident('menu')).toBe('menu_');
  });
});

describe('converting a Ren\'Py story', () => {
  it('converts characters, labels, dialogue, menus and conditions', () => {
    const c = convert(`
define e = Character("Eileen", color="#c8ffc8")
define s = Character(_("Sylvie"), image="sylvie")
define mc = DynamicCharacter("player_name")
define config.name = _("My Game")
default points = 0
default player_name = "You"
default persistent.seen = False

label start:
    scene bg room with fade
    e "Hello, [player_name]!"
    s happy "Hi!"
    extend " Nice to meet you."
    "Narration."
    menu:
        "Which way?"
        "Left":
            $ points += 1
            jump left
        "Right" if points > 0:
            pass
    if persistent.seen:
        e "Again?"
    elif points == 1:
        e "One."
    else:
        e "None."

label left:
    mc "Here."
    return
`);
    expect(c.story).toContain('title: My Game');
    expect(c.story).toContain('start: start');
    expect(c.story).toContain('narration: plain');
    expect(c.story).toContain('define e "Eileen" color=#c8ffc8');
    expect(c.story).toContain('define sylvie "Sylvie"');
    expect(c.story).toContain('define mc "{player_name}"');
    expect(c.story).toContain('var points = 0');
    expect(c.story).toContain('var player_name = "You"');
    expect(c.story).toContain('global var persistent_seen = false');
    expect(c.files['scripts/script.vn']).toBe(`label start:
  scene bg room with fade 1
  e: "Hello, {player_name}!"
  sylvie happy: "Hi![w] Nice to meet you."
  "Narration."
  "Which way?"
  menu:
    "Left":
      set points += 1
      jump left
    "Right" if points > 0:
      wait 0
  if persistent_seen:
    e: "Again?"
  elif points == 1:
    e: "One."
  else:
    e: "None."
  jump left

label left:
  mc: "Here."
  return
`);
  });

  it('places pictures as Ren\'Py does, from its transforms', () => {
    const vn = script(`
init python:
    gui.init(1280, 720)
transform pos(x=640, z=1.0):
    yanchor 1.0
    on show:
        alpha 0.0
        xcenter x zoom z
        linear 0.2 alpha 1.0
    on hide:
        linear 0.2 alpha 0.0
transform l1:
    pos(320, 0.8)
define mid = Position(xalign=0.5)
label start:
    show eileen happy at l1 zorder 2
    show eileen sad
    show lucy at left
    show lucy at mid with move
    show bob at unknown_transform
    hide lucy with dissolve
    scene bg with Dissolve(1.5)
    show bob
`);
    expect(vn).toBe(`# renpy: init python:
  # renpy: gui.init(1280, 720)
label start:
  show eileen happy at 320 100% anchor 50% 100% zoom 0.8 depth 2
  show eileen sad
  show lucy at 0% 100% anchor 0% 100%
  show lucy at 50% 100% anchor 50% 100% with move
  show bob
  hide lucy with dissolve 0.5
  scene bg with dissolve 1.5
  show bob at 50% 100% anchor 50% 100%
`);
    expect(convert('init python:\n    gui.init(1920, 1080)\nlabel start:\n    "x"\n').story).toContain('canvas: 1920x1080');
  });

  it('keeps what it can’t convert as comments, runs on into the next label, and reports', () => {
    const c = convert(`
label start:
    "One."
    python:
        x = compute()
    $ y = len(items)
    $ renpy.pause(1.5)
    pause
    call screen inventory
    window hide
label next:
    "Two."
`);
    expect(c.files['scripts/script.vn']).toBe(`label start:
  "One."
  # renpy: python:
    # renpy: x = compute()
  # renpy: $ y = len(items)
  wait 1.5
  # renpy: pause
  # renpy: call screen inventory
  jump next

label next:
  "Two."
`);
    expect(c.issues.map((i) => [i.line, i.why])).toEqual([
      [4, 'Python blocks aren’t imported'],
      [6, 'Python Emaki can’t run'],
      [8, 'a pause until the player clicks (Emaki pauses for a time)'],
      [9, 'Ren’Py screens aren’t imported'],
    ]);
    expect(c.counts['window show and hide (left out: the text box shows with lines)']).toBe(1);
  });

  it('finds images: files, composites, solid colours and the images folder', () => {
    const files = new Set(['images/eileen happy.png', 'images/bg/room.jpg', 'parts/body.png', 'parts/face.png', 'cg/one.png']);
    const assets: Assets = { exists: (p) => files.has(p), imageFiles: ['eileen happy.png', 'bg/room.jpg'] };
    const c = convert(`
image black2 = "#000"
image sylvie smile = im.Composite((400, 600), (0, 0), "parts/body.png", (100, 50), "parts/face.png")
image cg one = "cg/one.png"
image cg anim:
    "cg one"
    pause 1.0
    "cg/one.png"
image broken = im.Flip("cg/one.png", horizontal=True)
label start:
    "x"
`, assets);
    const byName = Object.fromEntries(c.images.map((i) => [i.name, i]));
    expect(byName['black2']).toMatchObject({ asset: 'imported/black2.png', made: { kind: 'solid', color: '#000' } });
    expect(byName['sylvie smile']).toMatchObject({ asset: 'imported/sylvie_smile.png', made: { kind: 'composite', size: [400, 600], parts: [{ at: [0, 0], path: 'parts/body.png' }, { at: [100, 50], path: 'parts/face.png' }] } });
    expect(byName['cg one']?.asset).toBe('cg/one.png');
    expect(byName['cg anim']?.asset).toBe('cg/one.png');
    expect(byName['eileen happy']?.asset).toBe('images/eileen happy.png');
    expect(byName['room']?.asset).toBe('images/bg/room.jpg');
    expect(byName['broken']).toBeUndefined();
    expect(c.issues.some((i) => i.text.startsWith('image broken'))).toBe(true);
  });

  it('converts sound, transitions and NVL', () => {
    const files = new Set(['audio/theme.ogg', 'sfx/door.ogg', 'voice/e1.ogg']);
    const vn = script(`
define audio.theme = "<loop 4.5>audio/theme.ogg"
define slow = Dissolve(2.0)
define n = Character("Nina", kind=nvl)
label start:
    play music theme fadein 1.0
    play sound "sfx/door.ogg"
    voice "voice/e1.ogg"
    "Line."
    with slow
    with vpunch
    stop music fadeout 2.0
    n "Page one."
    nvl clear
    "Back to the box."
`, { exists: (p) => files.has(p), imageFiles: [] });
    expect(vn).toBe(`label start:
  play music theme fade 1
  play sound "sfx/door.ogg"
  play voice "voice/e1.ogg"
  "Line."
  with dissolve 2
  shake
  stop music fade 2
  nvl on
  n: "Page one."
  nvl clear
  nvl off
  "Back to the box."
`);
  });
});

describe('importing a Ren\'Py project', () => {
  async function project(): Promise<string> {
    const dir = tempDir();
    const game = join(dir, 'game');
    mkdirSync(join(game, 'images'), { recursive: true });
    mkdirSync(join(game, 'parts'), { recursive: true });
    const px = (w: number, h: number, r: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    writeFileSync(join(game, 'images', 'room.png'), await px(32, 18, 200));
    writeFileSync(join(game, 'parts', 'body.png'), await px(20, 30, 10));
    writeFileSync(join(game, 'parts', 'face.png'), await px(10, 10, 250));
    writeFileSync(join(game, 'options.rpy'), 'define config.name = _("Tiny")\ninit python:\n    gui.init(320, 180)\n');
    writeFileSync(join(game, 'script.rpy'), `define e = Character("Eileen", image="eileen")
image eileen happy = im.Composite((20, 30), (0, 0), "parts/body.png", (5, 5), "parts/face.png")
label start:
    scene room
    show eileen happy at left
    e happy "Hello."
    e sad "No such picture: the line stays, without it."
    show ghost
    "The end."
`);
    writeFileSync(join(game, 'script.rpyc'), 'compiled');
    return dir;
  }

  it('makes a game that compiles, with its files, composites and a report', async () => {
    const src = await project();
    const dest = join(tempDir(), 'tiny');
    const r = await importRenpy(src, dest);
    expect(r).toMatchObject({ scripts: 2, labels: 1, copied: 3, made: 1 });
    expect(existsSync(join(dest, 'assets', 'images', 'room.png'))).toBe(true);
    expect(existsSync(join(dest, 'assets', 'script.rpyc'))).toBe(false);
    const made = await sharp(join(dest, 'assets', 'imported', 'eileen_happy.png')).metadata();
    expect([made.width, made.height]).toEqual([20, 30]);
    const compiled = compileGame(dest);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(compiled.story?.meta.title).toBe('Tiny');
    const vn = readFileSync(join(dest, 'scripts', 'script.vn'), 'utf8');
    expect(vn).toContain('  eileen happy: "Hello."');
    expect(vn).toContain('  eileen: "No such picture: the line stays, without it."');
    expect(vn).toContain(`  # renpy (didn't compile): show ghost`);
    const report = readFileSync(r.report, 'utf8');
    expect(report).toContain('## Commented out because they didn\'t compile (2)');
    expect(r.fixed).toBe(2);
  });

  it('refuses built games and folders that aren\'t empty', async () => {
    const built = tempDir();
    mkdirSync(join(built, 'game'));
    writeFileSync(join(built, 'game', 'scripts.rpa'), 'x');
    await expect(importRenpy(built, join(tempDir(), 'out'))).rejects.toThrow(/only built scripts/);
    const src = await project();
    const full = tempDir();
    writeFileSync(join(full, 'story.vn'), '');
    await expect(importRenpy(src, full)).rejects.toThrow(/already has files/);
  });
});
