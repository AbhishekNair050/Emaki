import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assetFile, serveAssets } from '../src/assets-middleware.ts';

const dir = mkdtempSync(join(tmpdir(), 'emaki-assets-'));
mkdirSync(join(dir, 'bg'));
writeFileSync(join(dir, 'bg', '夜の庭.png'), 'PNGDATA');
writeFileSync(join(dir, 'voice.ogg'), '0123456789');
writeFileSync(join(tmpdir(), 'emaki-outside.txt'), 'secret');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Run the middleware on a request; resolves with what it sent, or 'next'. */
function get(url: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<'next' | { status: number; headers: Record<string, string>; body: string }>((done) => {
    const sent: Record<string, string> = {};
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 200,
      setHeader(k: string, v: string) { sent[k.toLowerCase()] = v; },
      write(c: Buffer) { chunks.push(Buffer.from(c)); return true; },
      end(c?: Buffer) { if (c) chunks.push(Buffer.from(c)); done({ status: res.statusCode, headers: sent, body: Buffer.concat(chunks).toString() }); },
      on() { return res; }, once() { return res; }, emit() { return true; }, removeListener() { return res; },
      destroy() {},
    };
    serveAssets(dir)({ url, method, headers } as unknown as IncomingMessage, res as unknown as ServerResponse, () => done('next'));
  });
}

describe('dev server assets', () => {
  it('serves a file with its type, including names that need encoding', async () => {
    const r = await get('/bg/%E5%A4%9C%E3%81%AE%E5%BA%AD.png');
    expect(r).toMatchObject({ status: 200, body: 'PNGDATA', headers: { 'content-type': 'image/png', 'content-length': '7' } });
  });

  it('serves byte ranges, for seeking in audio and video', async () => {
    expect(await get('/voice.ogg', { range: 'bytes=2-5' })).toMatchObject({ status: 206, body: '2345', headers: { 'content-range': 'bytes 2-5/10' } });
    expect(await get('/voice.ogg', { range: 'bytes=7-' })).toMatchObject({ status: 206, body: '789' });
    expect(await get('/voice.ogg', { range: 'bytes=-3' })).toMatchObject({ status: 206, body: '789' });
    expect(await get('/voice.ogg', { range: 'bytes=20-' })).toMatchObject({ status: 416 });
  });

  it('passes on what it does not have, and never leaves the folder', async () => {
    expect(await get('/src/main.ts')).toBe('next');
    expect(await get('/bg')).toBe('next');
    expect(await get('/voice.ogg', {}, 'POST')).toBe('next');
    expect(assetFile(dir, '/../emaki-outside.txt')).toBeNull();
    expect(assetFile(dir, '/%2e%2e/emaki-outside.txt')).toBeNull();
    expect(assetFile(dir, '/bg/..%2F..%2Femaki-outside.txt')).toBeNull();
  });
});
