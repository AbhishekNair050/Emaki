declare module 'virtual:sandbox-data' {
  export const story: string;
  export const bundled: { path: string; kind: 'image' | 'audio'; size: number }[];
}
