// Whether RainViewer's radar reaches a place, from its coverage tile there: black where the radar has
// nothing, see-through where it reaches. One pixel is read, at the radar's deepest zoom (about a
// kilometre a pixel), and the answer kept per place for as long as the page is open. Undefined
// where it can't be told, the tile not having come or the browser not decoding it off screen; such
// a place is asked about again next time.
import { tilePoint } from './sources.ts';
import { coverageTile } from '../lib/services.ts';

const ZOOM = 7,
  PLACE_DIGITS = 2,
  ALPHA = 3;

const known = new Map<string, Promise<boolean | undefined>>();

async function ask(latitude: number, longitude: number): Promise<boolean | undefined> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return undefined;
  try {
    const { x, y } = tilePoint(latitude, longitude, ZOOM),
      across = 2 ** ZOOM,
      col = ((Math.floor(x) % across) + across) % across,
      response = await fetch(coverageTile(ZOOM, col, Math.floor(y)));
    if (!response.ok) return undefined;
    const picture = await createImageBitmap(await response.blob()),
      context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    const left = Math.min(picture.width - 1, Math.floor((x - Math.floor(x)) * picture.width)),
      top = Math.min(picture.height - 1, Math.floor((y - Math.floor(y)) * picture.height));
    context.drawImage(picture, left, top, 1, 1, 0, 0, 1, 1);
    picture.close();
    return (context.getImageData(0, 0, 1, 1).data[ALPHA] ?? 0) === 0;
  } catch {
    return undefined;
  }
}

export async function radarReaches(latitude: number, longitude: number): Promise<boolean | undefined> {
  const key = `${latitude.toFixed(PLACE_DIGITS)},${longitude.toFixed(PLACE_DIGITS)}`;
  let answer = known.get(key);
  if (!answer) {
    answer = ask(latitude, longitude);
    known.set(key, answer);
  }
  const reaches = await answer;
  if (reaches === undefined) known.delete(key);
  return reaches;
}
