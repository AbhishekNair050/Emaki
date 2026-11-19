/**
 * Only answer requests addressed to this computer by a local name or an IP
 * address. A web page can point its own domain at 127.0.0.1 (DNS rebinding);
 * the browser then treats the dev server as that page's own site, and an
 * Origin check alone would let it read and rewrite the game's files. Such a
 * request still carries the page's domain in its Host header, so it's turned
 * away here.
 *
 * Vite has the same check, but it runs after the middlewares plugins add in
 * configureServer, so the editor's and player's own routes need this first.
 * It follows Vite's `server.allowedHosts`: `true` turns the check off, and
 * listed names (".example.com" for its subdomains too) are let in.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

/** Whether a Host header names this computer: localhost, *.localhost, or an IP address (any port). */
export function isLocalHost(host: string | undefined, allowed: readonly string[] = []): boolean {
  if (!host) return false;
  let name: string;
  try { name = new URL(`http://${host}`).hostname.toLowerCase(); } catch { return false; }
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (isIP(name.replace(/^\[|\]$/g, ''))) return true;
  return allowed.some((a) => {
    const n = a.toLowerCase();
    return n.startsWith('.') ? name === n.slice(1) || name.endsWith(n) : name === n;
  });
}

/** Connect middleware: refuse requests for any other host (see above). */
export function localHostsOnly(allowedHosts: readonly string[] | true | undefined) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (allowedHosts === true || isLocalHost(req.headers.host, allowedHosts ?? [])) return next();
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Blocked: this server only answers requests for localhost or an IP address, not '${req.headers.host ?? ''}'.\n`);
  };
}
