/**
 * The dev server's view of a game's assets/ folder: each file is read from
 * disk when it's asked for. Vite's own public folder lists every file when the
 * server starts and watches them all, which for a full-length game (tens of
 * thousands of pictures and voices) takes most of a minute.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
};

/** The file under `dir` that `url` names, or null (outside the folder, missing, or a folder). */
export function assetFile(dir: string, url: string): { path: string; size: number } | null {
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(url, 'http://x').pathname); } catch { return null; }
  const root = resolve(dir);
  const path = resolve(root, '.' + pathname);
  if (path !== root && !path.startsWith(root + sep)) return null;
  try {
    const st = statSync(path);
    return st.isFile() ? { path, size: st.size } : null;
  } catch { return null; }
}

/** Connect middleware serving `dir` at the site root; anything it doesn't have goes to `next`. */
export function serveAssets(dir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.url) return next();
    const file = assetFile(dir, req.url);
    if (!file) return next();
    res.setHeader('Content-Type', TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    let start = 0;
    let end = file.size - 1;
    // Audio and video ask for byte ranges to seek and to read their length.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], end); }
      else start = Math.max(0, file.size - +range[2]!);
      if (start > end || start >= file.size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${file.size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    res.setHeader('Content-Length', String(file.size ? end - start + 1 : 0));
    if (req.method === 'HEAD' || file.size === 0) { res.end(); return; }
    createReadStream(file.path, { start, end }).on('error', () => res.destroy()).pipe(res);
  };
}
