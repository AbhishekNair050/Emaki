// The bridge between the launcher page and Emaki Studio: what a browser tab
// can't do on its own, nothing more. Preloads in sandboxed windows must be CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emakiStudio', {
  /** The system's folder picker. Resolves to the chosen folder, or null when cancelled. */
  pickFolder: (options) => ipcRenderer.invoke('studio:pick-folder', {
    title: String(options?.title ?? ''),
    defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
  }),
});
