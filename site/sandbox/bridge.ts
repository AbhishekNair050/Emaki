import { bundled, story } from 'virtual:sandbox-data';
import './shell.css';

const MAX_FILES = 12;
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_UPLOAD_TOTAL = 32 * 1024 * 1024;
type Asset = typeof bundled[number];
const files = new Map([['story.vn', { text: story, version: '0' }]]);
const assets = new Map(bundled.map((asset) => [asset.path, asset]));
const uploads = new Map<string, string>();
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const audioTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/opus', 'audio/flac', 'audio/x-wav']);
let revision = 0;
let bytes = 0;

const values = new Map<string, string>();
export const memoryStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

export function scriptWithinLimits(text: string): boolean {
  if (text.length > 64_000) return false;
  const lines = text.split(/\r\n?|\n/);
  return lines.length <= 2500 && lines.every((line) => line.length <= 1200 && /^[ \t]*/.exec(line)![0].length <= 64);
}

export function sandboxAssetUrl(path: string): string {
  if (!assets.has(path)) return 'data:,';
  return uploads.get(path) ?? `./${path.split('/').map(encodeURIComponent).join('/')}`;
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

function newPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/\\/g, '/');
  const name = path.endsWith('.vn') ? path : `${path}.vn`;
  return name.length <= 120 && /^(?:[\w-]+\/)*[\w-]+\.vn$/.test(name) ? name : null;
}

function addAsset(name: string | null, body: RequestInit['body']): Response {
  if (!(body instanceof Blob) || !name) return fail(400, 'Choose an image or audio file.');
  const type = body.type.toLowerCase();
  const kind = imageTypes.has(type) ? 'image' : audioTypes.has(type) ? 'audio' : null;
  if (!kind) return fail(415, 'Use PNG, JPEG, WebP, GIF, AVIF, MP3, WAV, Ogg, M4A, Opus or FLAC.');
  if (body.size > MAX_UPLOAD || bytes + body.size > MAX_UPLOAD_TOTAL || uploads.size >= 24) return fail(413, 'This tab has reached its upload limit. Use smaller files or reset the demo.');
  const safe = name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '').slice(-76) || 'media';
  const path = `${kind === 'image' ? 'images' : 'audio'}/${uploads.size + 1}-${safe}`;
  const asset: Asset = { kind, path, size: body.size };
  uploads.set(path, URL.createObjectURL(body));
  assets.set(path, asset);
  bytes += body.size;
  return Response.json(asset);
}

/** Same contract as the editor's disk API. This adapter performs no network requests. */
export const sandboxFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin) return fail(403, 'This demo only uses local files.');
  const method = init?.method ?? 'GET';
  try {
    if (url.pathname === '/__emaki/assets') {
      if (method === 'GET') return Response.json([...assets.values()].sort((a, b) => a.path.localeCompare(b.path)));
      if (method === 'POST') return addAsset(url.searchParams.get('name'), init?.body);
    }
    if (url.pathname === '/__emaki/files') {
      if (method === 'GET') return Response.json({ files: [...files.keys()], ...(url.searchParams.has('text') ? { texts: Object.fromEntries(files) } : {}) });
      if (method === 'POST') {
        const path = newPath(JSON.parse(String(init?.body)).path);
        if (!path) return fail(400, 'Use a name like chapter2.vn or routes/mira.vn.');
        if (files.has(path)) return fail(409, 'That file already exists in this tab.');
        if (files.size >= MAX_FILES) return fail(413, 'This tab has reached its script file limit.');
        files.set(path, { text: '', version: String(++revision) });
        return Response.json({ path, files: [...files.keys()] }, { status: 201 });
      }
    }
    if (url.pathname === '/__emaki/story') {
      const path = url.searchParams.get('file') ?? 'story.vn';
      const file = files.get(path);
      if (!file) return fail(404, 'That file is not in this demo.');
      if (method === 'GET') return Response.json(file);
      if (method === 'PUT') {
        const { text, base } = JSON.parse(String(init?.body));
        if (typeof text !== 'string' || !scriptWithinLimits(text)) return fail(413, 'Shorten the script or split up long lines.');
        if (base !== file.version) return Response.json(file, { status: 409 });
        const version = String(++revision);
        files.set(path, { text, version });
        return Response.json({ version });
      }
    }
  } catch {
    return fail(400, 'Could not read this demo request.');
  }
  return fail(404, 'That action is unavailable in the demo.');
};

document.querySelector('#sandbox-reset')?.addEventListener('click', () => {
  if (confirm('Discard the changes in this tab and restart the demo?')) location.reload();
});
