/**
 * What the player can ask of the app it runs in.
 *
 * The same web build runs in a browser, in the desktop app (Electron) and in
 * the phone apps (Capacitor). Each shell exposes what it can as
 * `window.emakiHost`; the player only uses what is there, so nothing here is
 * required and a plain browser needs none of it.
 */

export interface EmakiHost {
  platform: 'web' | 'desktop' | 'android' | 'ios';
  /** Close the game (desktop, Android). Absent where apps shouldn't quit themselves (iOS, browsers). */
  quit?(): void;
  /** Toggle full screen; resolves to the new state. */
  setFullscreen?(on: boolean): Promise<boolean>;
  isFullscreen?(): Promise<boolean>;
  /** Tell the platform (Steam) an achievement was earned. Safe to call more than once. */
  unlockAchievement?(id: string): void;
  /** True when the platform shows its own "achievement unlocked" popup, so the game shouldn't. */
  notifiesAchievements?: boolean;
  /** Called with a handler for the hardware back button (Android). */
  onBackButton?(handler: () => void): void;
}

interface CapacitorGlobal {
  getPlatform?(): string;
  Plugins?: { App?: { exitApp(): void; addListener(event: 'backButton', fn: () => void): unknown } };
}

/** The host the game is running in. */
export function detectHost(): EmakiHost {
  const w = globalThis as unknown as { emakiHost?: EmakiHost; Capacitor?: CapacitorGlobal };
  if (w.emakiHost) return w.emakiHost;
  const cap = w.Capacitor;
  const platform = cap?.getPlatform?.();
  if (cap && (platform === 'android' || platform === 'ios')) {
    const app = cap.Plugins?.App;
    return {
      platform,
      // Apple's guidelines say apps don't quit themselves; Android players expect it.
      ...(platform === 'android' && app ? { quit: () => app.exitApp() } : {}),
      ...(app ? { onBackButton: (fn: () => void) => { app.addListener('backButton', fn); } } : {}),
    };
  }
  return browserHost();
}

/** A plain browser: full screen through the Fullscreen API, when allowed. */
function browserHost(): EmakiHost {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc?.fullscreenEnabled) return { platform: 'web' };
  return {
    platform: 'web',
    async setFullscreen(on) {
      try {
        if (on && !doc.fullscreenElement) await doc.documentElement.requestFullscreen();
        if (!on && doc.fullscreenElement) await doc.exitFullscreen();
      } catch { /* refused (e.g. inside an iframe without permission) */ }
      return !!doc.fullscreenElement;
    },
    isFullscreen: async () => !!doc.fullscreenElement,
  };
}
