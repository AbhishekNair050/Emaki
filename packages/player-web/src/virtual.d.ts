declare module 'virtual:emaki-game' {
  import type { CompiledStory, Diagnostic, StoryGraph } from '@emaki/format';
  export const story: CompiledStory | null;
  export const diagnostics: Diagnostic[];
  export const sourceLines: string[];
  /** Only present on the dev server (null in builds). */
  export const graph: StoryGraph | null;
}
