declare module 'virtual:emaki-plugins' {
  import type { PluginManifest } from '@emaki/format';
  import type { PluginSetup } from './plugins.ts';
  /** The game's plugins' code, by name. */
  export const plugins: Record<string, PluginSetup>;
  export const manifests: Record<string, PluginManifest>;
}

declare module 'virtual:emaki-game' {
  import type { CompiledStory, CompiledTranslation, Diagnostic, StoryGraph } from '@emaki/format';
  /**
   * Fetch the game's data (game.json; the dev server compiles it on request),
   * with the story ready to run. Same shape as GameData in emaki-plugin.ts.
   */
  export function loadGame(): Promise<{
    /** Null when the story has errors (dev only: a build would have failed). */
    story: CompiledStory | null;
    /** Compiled lang/*.po and lang/*.csv files. */
    translations: CompiledTranslation[];
    diagnostics: Diagnostic[];
    /** Each file's lines by path ('' for story.vn), for the error screen: dev server only, when there are errors. */
    sourceLines: Record<string, string[]>;
    /** Only present on the dev server (null in builds). */
    graph: StoryGraph | null;
    /** In a compressed export: the new names of files that changed format (bg/a.png → bg/a.webp). */
    renamed?: Record<string, string>;
    /** In an export that made large pictures smaller: the size each had, by its path. */
    sizes?: Record<string, [number, number]>;
  }>;
}
