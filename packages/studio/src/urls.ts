/**
 * What Studio windows may show. The launcher, editor and player are served on
 * this computer's loopback address; anything else opens in the system browser.
 */
export function isLocalUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.username === '' && url.password === '';
}

/** Links that leave the Studio go to the system browser; nothing else is handed to the system. */
export function isExternalUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') && !isLocalUrl(value);
}
