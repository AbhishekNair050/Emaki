(() => {
  if (window !== window.top || location.origin !== 'https://game.emaki.invalid') return;
  const channel = window.chrome.webview;
  const pending = new Map();
  let next = 0;
  function ask(action, on) {
    return new Promise(resolve => {
      const id = ++next;
      pending.set(id, resolve);
      channel.postMessage({ action, on, id });
    });
  }
  channel.addEventListener('message', ({ data }) => {
    if (!pending.has(data.id)) return;
    pending.get(data.id)(data.fullscreen);
    pending.delete(data.id);
  });
  window.emakiHost = {
    platform: 'desktop',
    quit: () => channel.postMessage({ action: 'quit' }),
    setFullscreen: on => ask('set', !!on),
    isFullscreen: () => ask('get'),
    // As in the Electron shell without Steam: achievements stay in the game.
    unlockAchievement: () => {},
    notifiesAchievements: false,
  };
  window.addEventListener('keydown', event => {
    if (event.key === 'F11' || (event.altKey && event.key === 'Enter')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) channel.postMessage({ action: 'toggle' });
    }
  }, true);
})();
