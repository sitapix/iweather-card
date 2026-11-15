import type { SheetCard, TileCard } from '../cards/card.ts';
import { aboutMarkup, sheetHeader } from '../sheets/parts.ts';
import { mapTile, mapView } from './view.ts';
import { phrase, say } from '../weather/words.ts';

const ABOUT = [
  phrase('About the Radar Map'),
  phrase(
    'Radar shows where precipitation is falling over the past two hours, in ten-minute steps. Brighter colors mean heavier precipitation. Radar coverage varies by region.',
  ),
] as const;
export const map: TileCard & SheetCard = {
  id: 'map',
  label: phrase('Precipitation map'),
  title: phrase('Precipitation Map'),
  wide: true,
  tile: mapTile,
  // Changing readings refresh the compact tile; the open map updates its own layers in place.
  redrawnBy: (ctx, layer) => mapView(ctx, layer)?.inputs,
  available: () => true,
  opens: () => ({ id: 'map' }),
  sheet({ ctx, mapLayer }) {
    const view = mapView(ctx, mapLayer);
    return view
      ? `${sheetHeader(view.glyph, view.title)}<div class="radar large" data-kind="${view.kind}" tabindex="0" role="application" aria-roledescription="${say('map')}" aria-label="${say('Map: the arrow keys move it, plus and minus zoom it')}"></div>${view.kind === 'precipitation' ? aboutMarkup(ABOUT) : ''}`
      : '';
  },
  // Named for the map it shows: wind, air quality or temperature.
  named(ctx, layer) {
    const view = mapView(ctx, layer);
    return view && view.kind !== 'precipitation' ? view.title : undefined;
  },
};
