declare module 'virtual:emaki-game' {
  import type { CompiledStory, CompiledTranslation, Diagnostic, StoryGraph } from '@emaki/format';
  export const story: CompiledStory | null;
  /** Compiled lang/*.po and lang/*.csv files. */
  export const translations: CompiledTranslation[];
  export const diagnostics: Diagnostic[];
  export const sourceLines: string[];
  /** Only present on the dev server (null in builds). */
  export const graph: StoryGraph | null;
}
