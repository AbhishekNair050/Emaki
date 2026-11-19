/** Works out one project's info off the launcher's main thread (see project-info.ts). */
import { parentPort, workerData } from 'node:worker_threads';
import { projectInfo } from './project-info.ts';

try {
  parentPort!.postMessage({ info: projectInfo(workerData as string) });
} catch (err) {
  parentPort!.postMessage({ error: err instanceof Error ? err.message : String(err) });
}
