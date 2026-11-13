import { EVENTS, fireEvent } from '../card/home-assistant.ts';

// Home Assistant's own haptic event: the Companion apps turn it into native feedback, and in a
// browser HA vibrates only when the user enabled Vibrate in their profile.
export type Haptic = 'success' | 'warning' | 'failure' | 'light' | 'medium' | 'heavy' | 'selection';
// The card's `haptics` setting: by default only the moon's timeline ticks past its marks, and the
// sheet menu past each sheet a held finger draws over; `all` adds the rest of the card's feedback;
// `off` gives none.
export interface HapticHost extends EventTarget {
  readonly config?: { readonly haptics: 'moon' | 'all' | 'off' } | undefined;
}
export function haptic(card: HapticHost | null | undefined, type: Haptic, from: 'moon' | 'card' = 'card'): void {
  const setting = card?.config?.haptics;
  if (card && (setting === 'all' || (setting === 'moon' && from === 'moon'))) fireEvent(card, EVENTS.haptic, type);
}
