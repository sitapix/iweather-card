// What the build writes into the card (see vite.config.ts).
// The version the card reports, and where MapLibre stands from the card's own file.
declare const __CARD_VERSION__: string;
declare const __CLOUD_ATLAS__: {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly (readonly [left: number, top: number, width: number, height: number])[];
} | null;
declare const __MAPLIBRE__: { readonly script: string; readonly style: string };
