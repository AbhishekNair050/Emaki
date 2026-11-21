/** Estimates a project's compressed export off the launcher's main thread (see estimateCompression). */
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { compileGame } from '@emaki/format/files';
import { estimateCompression, gameFacts, readCompression } from './compress.ts';

const dir = workerData as string;
try {
  let story = null;
  // Without a story (errors), voices are still found by their folder.
  try { story = compileGame(dir).story; } catch { /* below */ }
  const estimate = await estimateCompression(dir, readCompression(dir), gameFacts(story), { cacheDir: join(dir, 'export', '.compress-cache') });
  parentPort!.postMessage({ estimate });
} catch (err) {
  parentPort!.postMessage({ error: err instanceof Error ? err.message : String(err) });
}
