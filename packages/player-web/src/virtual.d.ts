declare module 'virtual:emaki-game' {
  import type { CompiledStory, Diagnostic } from '@emaki/format';
  export const story: CompiledStory | null;
  export const diagnostics: Diagnostic[];
  export const sourceLines: string[];
}
