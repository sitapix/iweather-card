// The hourly panel's switch between its views, a glass switch (see GlassSwitch).
import { GlassSwitch } from '../../lib/glass-switch.ts';
import { haptic } from '../../lib/haptics.ts';
import { crossFade } from '../../lib/cross-fade.ts';
import { isMode, type Mode } from './rows.ts';
import type { Parts } from '../../card/parts.ts';

const switches = new WeakMap<HTMLElement, GlassSwitch>();
// The last view fades out and the new one in, each in an eighth of a second: the strip of hours and
// the daily list under it. The heading and the line under it change at once.
const VIEW_FADE = { duration: 250, easing: 'ease-in-out' } as const;

// The switch's thumb sits under the selected option.
export function placeThumb({ modes }: Pick<Parts, 'modes'>) {
  switches.get(modes)?.place();
}

// What the switch reads from the card, and sets on it.
interface SwitchHost extends EventTarget {
  readonly parts: Parts;
  readonly motion: MediaQueryList | undefined;
  mode: Mode | undefined;
  render(): void;
}
export function bindForecastSwitch(card: SwitchHost) {
  const glass = new GlassSwitch('[data-mode]', option => {
    const mode = option.dataset['mode'];
    if (!isMode(mode)) return;
    if (card.mode !== mode) haptic(card, 'selection');
    card.mode = mode;
    // The view showing chosen again only draws.
    if (card.parts.hours.dataset['mode'] === mode) {
      card.render();
      return;
    }
    crossFade(
      [card.parts.hours, card.parts.dailyList],
      () => {
        card.render();
      },
      VIEW_FADE,
      card.motion?.matches === true,
    );
  });
  switches.set(card.parts.modes, glass);
  glass.attach(card.parts.modes);
}
