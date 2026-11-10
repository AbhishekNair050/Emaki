declare module 'virtual:emaki-plugins' {
  import type { PluginManifest } from '@emaki/format';
  import type { PluginSetup } from './plugins.ts';
  /** The game's plugins' code, by name. */
  export const plugins: Record<string, PluginSetup>;
  export const manifests: Record<string, PluginManifest>;
}

declare module 'virtual:emaki-game' {
  import type { CompiledStory, CompiledTranslation, Diagnostic, StoryGraph } from '@emaki/format';
  export const story: CompiledStory | null;
  /** Compiled lang/*.po and lang/*.csv files. */
  export const translations: CompiledTranslation[];
  export const diagnostics: Diagnostic[];
  /** Each file's lines by path ('' for story.vn). */
  export const sourceLines: Record<string, string[]>;
  /** Only present on the dev server (null in builds). */
  export const graph: StoryGraph | null;
}
