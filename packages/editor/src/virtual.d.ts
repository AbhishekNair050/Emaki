/** The game's theme.css (empty when it has none); see the editor's server plugin. */
declare module 'virtual:emaki-theme' {}
declare module 'virtual:emaki-plugins' {
  import type { PluginManifest } from '@emaki/format';
  import type { PluginSetup } from '@emaki/player-web/plugins';
  export const plugins: Record<string, PluginSetup>;
  export const manifests: Record<string, PluginManifest>;
}
