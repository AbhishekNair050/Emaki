import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { AssetStore } from '../../packages/editor/src/server/asset-store.ts';

const bridge = join(import.meta.dirname, 'bridge.ts').replaceAll('\\', '/');
const virtualBridge = 'virtual:sandbox-bridge';

/** Fail the site build if an upstream editor change removes an adapter hook. */
function replaceHook(code, match, replacement, name) {
  const index = code.indexOf(match);
  if (index < 0 || code.indexOf(match, index + match.length) >= 0) throw new Error(`Expected one sandbox hook for ${name}`);
  return code.slice(0, index) + replacement + code.slice(index + match.length);
}

const prefix = (imports) => `import { ${imports} } from '${virtualBridge}';\n`;

export async function buildSandbox(repo, outDir) {
  const gameDir = join(repo, 'games', 'gullwing');
  const publicDir = join(gameDir, 'assets');
  const story = await readFile(join(gameDir, 'story.vn'), 'utf8');
  const bundled = new AssetStore(publicDir).list();
  const virtual = new Map([
    ['virtual:emaki-theme', ''],
    ['virtual:emaki-plugins', 'export const manifests = {}, plugins = {};'],
    ['virtual:sandbox-data', `export const story = ${JSON.stringify(story)}, bundled = ${JSON.stringify(bundled)};`],
  ]);
  const packages = resolve(repo, 'packages').replaceAll('\\', '/') + '/';

  await build({
    root: join(repo, 'packages', 'editor'), base: './', configFile: false, logLevel: 'warn', publicDir,
    build: { outDir, emptyOutDir: true },
    plugins: [{
      name: 'emaki-pages-sandbox',
      enforce: 'pre',
      resolveId(id) { return id === virtualBridge ? bridge : virtual.has(id) ? '\0' + id : null; },
      load(id) { return id.startsWith('\0') ? virtual.get(id.slice(1)) ?? null : null; },
      transform(code, id) {
        if (!id.startsWith(packages)) return null;
        switch (id.slice(packages.length)) {
          case 'editor/src/main.ts': {
            const leave = code.match(/  window\.addEventListener\('beforeunload',[\s\S]*?\r?\n  \}\);\r?\n/)?.[0];
            if (!leave) throw new Error('Missing sandbox discard-on-reload hook');
            code = replaceHook(code, leave, '', 'discard on reload');
            code = replaceHook(code, "saved: 'Saved'", "saved: 'In this tab'", 'save status');
            code = replaceHook(code, '`${active} on disk matches the editor`', "'These edits disappear on reload.'", 'save tooltip');
            return prefix('sandboxFetch as fetch, memoryStorage as localStorage') + code;
          }
          case 'editor/src/sync.ts':
            return prefix('sandboxFetch') + replaceHook(code, 'globalThis.fetch.bind(globalThis)', 'sandboxFetch', 'editor transport');
          case 'editor/src/assets.ts':
            code = replaceHook(code, 'img.src = `./${a.path}`', 'img.src = sandboxAssetUrl(a.path)', 'asset thumbnail');
            code = replaceHook(code, 'new Audio(`./${a.path}`)', 'new Audio(sandboxAssetUrl(a.path))', 'asset audio');
            return prefix('sandboxFetch as fetch, sandboxAssetUrl') + code;
          case 'editor/src/inspector.ts': {
            const image = 'img.src = `./${path}`';
            if (code.split(image).length !== 3) throw new Error('Expected two inspector image hooks');
            code = code.replaceAll(image, 'img.src = sandboxAssetUrl(path)');
            return prefix('sandboxAssetUrl') + replaceHook(code, 'img.src = `./${card.picture}`', 'img.src = sandboxAssetUrl(card.picture)', 'inspector scene picture');
          }
          case 'editor/src/script/script-pane.ts':
            return prefix('scriptWithinLimits') + replaceHook(code, '      basicSetup,', `      EditorState.changeFilter.of((tr) => {
        if (!tr.docChanged || (tr.newDoc.length <= 64000 && scriptWithinLimits(tr.newDoc.toString()))) return true;
        document.querySelector('#sandbox-notice span')!.textContent = 'This demo is for short scripts. Try a smaller edit or split long lines.';
        return false;
      }),\n      basicSetup,`, 'script size');
          case 'editor/src/dock.ts':
          case 'player-web/src/settings.ts':
            return prefix('memoryStorage as localStorage') + code;
          case 'player-web/src/player.ts': {
            const start = code.indexOf('export function asset(path: string): string {');
            const end = code.indexOf('\n}', start);
            if (start < 0 || end < 0) throw new Error('Missing sandbox player asset hook');
            return prefix('sandboxAssetUrl, memoryStorage as localStorage, memoryStorage as sessionStorage') +
              code.slice(0, start) + 'export function asset(path: string): string { return sandboxAssetUrl(path); }' + code.slice(end + 2);
          }
          default: return null;
        }
      },
      transformIndexHtml(html) {
        const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob: data:; base-uri 'none'; form-action 'none'";
        const notice = '<div id="sandbox-notice"><span><strong>Gullwing Sandbox.</strong> Edits and uploaded assets disappear when you refresh or close this tab.</span><a href="../../play/gullwing/">Play the original</a><button type="button" id="sandbox-reset">Reset demo</button></div>';
        return html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`)
          .replace('</header>', `</header>\n    ${notice}`)
          .replace('>Saved</span>', '>In this tab</span>');
      },
    }],
  });
}
