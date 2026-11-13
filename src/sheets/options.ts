// A sheet's options, last: a row for each kind of reading it shows in a unit, its name at the left
// and the unit at the right beside a chevron up and down, which opens a menu of the units it can be
// shown in (see glass-menu.ts). The menu rises over the row where there is no room under it. On a
// computer the unit opens the system's own menu instead (see SYSTEM_MENU). What is picked there is
// the card's to keep (see unit-choices.ts).
import { esc } from '../lib/html.ts';
import { bindGlassMenu, glassMenuMarkup, type MenuChoice } from '../lib/glass-menu.ts';
import { AUTO, isBeaufort, UNIT_KIND_NAMES, UNIT_KINDS, UNITS, type UnitKind } from '../weather/units.ts';
import { phrase, say } from '../weather/words.ts';
import { sheetSection } from './parts.ts';

// What the options read from the card, and ask of it.
export interface UnitsHost {
  // A kind's setting as the card follows it now: 'auto' or a unit.
  setting: (kind: UnitKind) => string;
  // The unit the weather entity gives a kind in, which 'auto' follows.
  own: (kind: UnitKind) => string | undefined;
  // A unit picked for a kind.
  pick: (kind: UnitKind, unit: string) => void;
}
// A row's name where a sheet has more than one.
const NAMES: Readonly<Record<UnitKind, string>> = {
  temperature_unit: phrase('Temperature'),
  wind_speed_unit: phrase('Wind'),
  precipitation_unit: phrase('Precipitation'),
  pressure_unit: phrase('Pressure'),
  distance_unit: phrase('Visibility'),
};
// Temperatures can follow Home Assistant's own units as well, as the menu says, which is what the
// weather entity gives them in.
const FOLLOWS: ReadonlySet<UnitKind> = new Set(['temperature_unit']);
const CHEVRON =
  '<svg class="option-chevron" viewBox="0 0 28 40" aria-hidden="true"><path d="M2 13.7 14 2l12 11.7M2 26.8l12 11.4 12-11.4"/></svg>';
// The card's spelling of a unit, so the entity's 'Beaufort' is the menu's 'bft'.
const spelled = (unit: string | undefined): string | undefined => (isBeaufort(unit) ? UNITS.beaufort : unit);
// A computer: a mouse or trackpad that can hover. There a row's unit is a select, unseen over the
// unit, so a click opens the system's own menu where the unit stands; a finger gets the glass menu.
export const SYSTEM_MENU = '(hover: hover) and (pointer: fine)';
// The row on a computer: the select names itself and says its unit, so what is drawn is hidden from
// a screen reader.
const systemRow = (kind: UnitKind, name: string, value: string, shown: string, choices: readonly MenuChoice[]) =>
  `<div class="option-row"><span class="option-name" aria-hidden="true">${esc(name)}</span><span class="option-value"><span aria-hidden="true">${esc(value)}</span>${CHEVRON}<select class="option-select" data-option="${kind}" aria-label="${esc(name)}">${choices.map(choice => `<option value="${esc(choice.value)}"${choice.value === shown ? ' selected' : ''}>${esc(choice.title)}</option>`).join('')}</select></span></div>`;

function optionRow(kind: UnitKind, name: string, units: UnitsHost): string {
  const setting = units.setting(kind),
    own = spelled(units.own(kind)),
    follows = FOLLOWS.has(kind),
    system = say('Use system setting ({unit})', { unit: own ?? '' }),
    choices: MenuChoice[] = [
      ...UNIT_KINDS[kind].options.map(([value, title]) => ({ value, title: say(title) })),
      ...(follows ? [{ value: AUTO, title: system }] : []),
    ],
    shown = setting === AUTO ? (follows ? AUTO : own) : setting,
    value = shown === AUTO ? system : (shown ?? '');
  if (matchMedia(SYSTEM_MENU).matches)
    return `<div class="sheet-option" data-option="${kind}">${systemRow(kind, name, value, shown ?? '', choices)}</div>`;
  return `<div class="sheet-option" data-option="${kind}"><button type="button" aria-haspopup="menu" aria-expanded="false"><span class="option-name">${esc(name)}</span><span class="option-value"><span>${esc(value)}</span>${CHEVRON}</span></button>${glassMenuMarkup(
    esc(name),
    shown ?? '',
    choices.map(choice => ({ ...choice, title: esc(choice.title) })),
    'option-menu',
  )}</div>`;
}
// The options for the kinds a sheet shows, if any.
export function optionsMarkup(kinds: readonly UnitKind[], units: UnitsHost): string {
  if (!kinds.length) return '';
  const rows = kinds.map(kind => optionRow(kind, kinds.length > 1 ? say(NAMES[kind]) : say('Unit'), units));
  return sheetSection(say('Options'), rows.join(''), { kind: 'detail-options' });
}

export interface OptionsHost extends Pick<UnitsHost, 'pick'> {
  // Its motion is off.
  still: () => boolean;
  // A menu opened.
  opened: () => void;
  // Another unit is lit under a held pointer.
  ticked: () => void;
}
// Rising, a menu ends where the row's unit does; the least room it keeps from the edges of what shows
// the sheet.
const ROOM = 8;
export function bindOptions(dialog: HTMLElement, host: OptionsHost) {
  // A unit picked from the system's menu.
  dialog.addEventListener('change', event => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const kind = UNIT_KIND_NAMES.find(name => name === select.dataset['option']);
    if (kind) host.pick(kind, select.value);
  });
  for (const kind of UNIT_KIND_NAMES)
    bindGlassMenu(dialog, {
      ...host,
      chosen: unit => host.pick(kind, unit),
      parts: () => {
        const row = dialog.querySelector(`.sheet-option[data-option="${kind}"]`),
          button = row?.querySelector<HTMLElement>(':scope>button'),
          menu = row?.querySelector<HTMLElement>(':scope>.option-menu:not([data-leaving])'),
          from = button?.querySelector<HTMLElement>('.option-value');
        return button && menu && from ? { button, menu, from } : undefined;
      },
      // It drops from the unit where there's room for it, and otherwise rises over it, unless there is
      // more room under it all the same. What shows the sheet ends at the screen's edge, or at the
      // sheet's own where that scrolls apart.
      place: ({ menu, from }) => {
        if (!from) return;
        menu.removeAttribute('data-rising');
        const { top, bottom } = from.getBoundingClientRect(),
          tall = menu.getBoundingClientRect().height,
          shown = [dialog, dialog.querySelector('.sheet')].map(each => each?.getBoundingClientRect()),
          floor = Math.min(innerHeight, ...shown.map(box => box?.bottom ?? innerHeight)) - ROOM,
          ceiling = Math.max(0, ...shown.map(box => box?.top ?? 0)) + ROOM,
          below = floor - top,
          above = bottom - ceiling;
        menu.toggleAttribute('data-rising', below < tall && above > below);
      },
    });
}
