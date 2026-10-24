// The bridge between the game page and the desktop shell: exactly the
// EmakiHost interface the player expects (packages/player-web/src/host.ts),
// nothing more. Preloads in sandboxed windows must be CommonJS.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('emaki:info');

contextBridge.exposeInMainWorld('emakiHost', {
  platform: 'desktop',
  quit: () => ipcRenderer.send('emaki:quit'),
  setFullscreen: (on) => ipcRenderer.invoke('emaki:fullscreen', !!on),
  isFullscreen: () => ipcRenderer.invoke('emaki:fullscreen'),
  unlockAchievement: (id) => ipcRenderer.send('emaki:achieve', String(id)),
  // Steam shows its own "achievement unlocked" popup.
  notifiesAchievements: !!info.steam,
});
