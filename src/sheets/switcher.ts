// From the foot of the screen, a sheet of a day's readings turns to another from a menu: a button
// at the right of its reading, its glyph beside a chevron, opens a menu of them over the sheet,
// each with its glyph, the one shown checked (see glass-menu.ts).
import { bindGlassMenu, glassMenuMarkup } from '../lib/glass-menu.ts';
import type { SheetId } from '../cards/ids.ts';

// A sheet the menu offers.
export interface SheetChoice {
  id: SheetId;
  title: string;
  glyph: string;
  // What it shows that its title doesn't say.
  shows: string;
}
const CHEVRON = '<svg class="sheet-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M2 2 6 6l4-4"/></svg>';
export function switcherMarkup(label: string, shown: SheetId, choices: readonly SheetChoice[]): string {
  const current = choices.find(choice => choice.id === shown);
  if (!current) return '';
  const menu = glassMenuMarkup(
    label,
    shown,
    choices.map(({ id, title, glyph, shows }) => ({ value: id, title, glyph, note: shows })),
    'sheet-menu',
  );
  return `<div class="sheet-switch"><button type="button" data-switch aria-haspopup="menu" aria-expanded="false" aria-label="${label}"><i class="sheet-glyph">${current.glyph}</i>${CHEVRON}</button>${menu}</div>`;
}

export interface SwitcherHost {
  // Its motion is off.
  still: () => boolean;
  // The menu opened.
  opened: () => void;
  // A sheet picked from it.
  chosen: (id: string) => void;
  // Another sheet is lit under a held pointer.
  ticked: () => void;
}
export function bindSwitcher(dialog: HTMLDialogElement, host: SwitcherHost) {
  bindGlassMenu(dialog, {
    ...host,
    parts: () => {
      const button = dialog.querySelector<HTMLElement>('.sheet-switch>[data-switch]'),
        menu = dialog.querySelector<HTMLElement>('.sheet-switch>.sheet-menu:not([data-leaving])');
      return button && menu ? { button, menu } : undefined;
    },
  });
}
