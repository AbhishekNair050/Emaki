/**
 * `emaki new <folder>`: a small game to start from, which runs as it is.
 *
 * It has what every game has (a header, a character, a background, a choice
 * and two scenes) and comments pointing to the docs, so a new writer can play
 * it at once and change it line by line. The background is hand-written SVG,
 * like the demo's placeholder art.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { splitComment } from '@emaki/format';

/** The starter story. `title` goes in the header. */
export function starterStory(title: string): string {
  return `---
title: ${splitComment(title).comment || title.startsWith('"') ? JSON.stringify(title) : title}
start: start
---

# Your story. Play it with the dev server or the editor (see the README),
# and see docs/script-syntax.md for everything you can write.

define ava "Ava" color=#e8b04b

image sky = "bg/sky.svg"

var curious = 0

label start:
  scene sky with fade
  "The evening is quiet. Somewhere below, a door opens."
  ava: There you are. I thought you'd never come.
  menu:
    "Ask her what she's been waiting for.":
      set curious += 1
      ava: For you to ask, mostly.
    "Say nothing and watch the sky.":
      ava: Fair enough. It is a good sky.
  jump ending

label ending:
  if curious > 0:
    ava: Come back tomorrow. I'll tell you the rest.
  else:
    "The stars come out one by one."
  "The end."
`;
}

/** A dusk sky: a gradient, a sun and a hill. */
export const STARTER_BACKGROUND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d2b53"/>
      <stop offset="0.6" stop-color="#7e5a8c"/>
      <stop offset="1" stop-color="#f2a65a"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <circle cx="1120" cy="640" r="90" fill="#ffd38a" opacity="0.9"/>
  <path d="M0 760 Q 400 640 800 720 T 1600 700 V 900 H 0 Z" fill="#2a2440"/>
</svg>
`;

const THEME = `/* Your game's look: colours, fonts, the text box. See docs/theming.md. */
`;

/** Write a new game into `dir` (which must not exist, or be empty). Returns the files written, relative to it. */
export function newGame(dir: string, title?: string): string[] {
  const full = resolve(dir);
  if (existsSync(full) && readdirSync(full).length) throw new Error(`${dir} already has files in it; pick a new folder`);
  const name = title?.trim() || titleFromFolder(basename(full));
  const files: Record<string, string> = {
    'story.vn': starterStory(name),
    'theme.css': THEME,
    'assets/bg/sky.svg': STARTER_BACKGROUND,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(full, path, '..'), { recursive: true });
    writeFileSync(join(full, path), text);
  }
  for (const empty of ['assets/sprites', 'assets/audio']) mkdirSync(join(full, empty), { recursive: true });
  return Object.keys(files);
}

/** `my-first_game` → "My First Game". */
export function titleFromFolder(folder: string): string {
  const words = folder.split(/[-_\s]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : 'My Game';
}
