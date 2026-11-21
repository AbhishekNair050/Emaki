import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildWeb } from '../packages/player-web/src/build.ts';

const site = import.meta.dirname;
const repo = resolve(site, '..');
const output = join(site, 'dist', 'public');
const github = 'https://github.com/AbhishekNair050/Emaki/blob/main/';
const documents = [
  'docs/getting-started.md',
  'docs/tools.md',
  'packages/vscode/README.md',
  'docs/script-syntax.md',
  'docs/theming.md',
  'docs/importing-from-renpy.md',
  'docs/plugins.md',
  'docs/exporting.md',
  'docs/story-format.md',
  'docs/decisions.md',
  'docs/roadmap.md',
  'CHANGELOG.md',
];

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return value.replace(/[&<>"]/g, character => entities[character]);
}

function readHeadings(markdown) {
  const headings = [];
  const anchors = new Set();
  let fence = '';

  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence)) fence = '';
      continue;
    }
    if (fence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (!heading) continue;
    const label = heading[2].replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    let anchor = base;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${base}-${suffix}`;
    anchors.add(anchor);
    headings.push({ label, anchor, level: heading[1].length });
  }
  return headings;
}

async function reference(doc) {
  const markdown = await readFile(join(repo, doc), 'utf8');
  const headings = readHeadings(markdown);
  const link = github + doc;
  const title = headings.find(heading => heading.level === 1)?.label ?? doc;
  const topics = headings.filter(heading => heading.level > 1)
    .map(({ label, anchor }) => `<li><a href="${link}#${encodeURIComponent(anchor)}">${escapeHtml(label)}</a></li>`);
  return `<details><summary>${escapeHtml(title)}</summary><p><a href="${link}">Open full document</a></p><ul>${topics.join('')}</ul></details>`;
}

const index = (await Promise.all(documents.map(reference))).join('\n          ');
const template = await readFile(join(site, 'index.html'), 'utf8');
const html = template.replace('<!-- reference-index -->', () => index);

await mkdir(join(output, 'screens'), { recursive: true });
await Promise.all([
  writeFile(join(output, 'index.html'), html),
  cp(join(site, 'style.css'), join(output, 'style.css')),
  cp(join(site, 'guide.js'), join(output, 'guide.js')),
  cp(join(site, 'screens'), join(output, 'screens'), { recursive: true }),
  cp(join(repo, 'docs', 'images', 'demo.png'), join(output, 'screens', 'demo.png')),
]);

for (const match of html.matchAll(/src="\.\/screens\/([^"]+)"/g)) {
  await readFile(join(output, 'screens', match[1]));
}

for (const game of ['gullwing', 'plugin-demo']) {
  const gameOutput = join(output, 'play', game);
  await buildWeb(join(repo, 'games', game), gameOutput, { quiet: true });
  if (game === 'gullwing') {
    const gamePage = join(gameOutput, 'index.html');
    const gameHtml = await readFile(gamePage, 'utf8');
    await cp(join(site, 'demo.css'), join(gameOutput, 'demo.css'));
    await writeFile(gamePage, gameHtml.replace('</head>', '  <link rel="stylesheet" href="./demo.css">\n  </head>'));
  }
}
console.log('Built the Emaki guide and both browser demos in site/dist/public.');
