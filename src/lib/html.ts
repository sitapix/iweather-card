// Text from outside the card (entity names, units, alert wording, attributes) made safe to
// place in the markup the card builds as strings.
const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, c => ENTITIES[c] ?? c);

export const PERCENT = 100;
// A share (0 to 1) as a CSS percentage, to a tenth by default: 0.375 is 37.5%.
export const percent = (share: number, digits = 1): string => `${(share * PERCENT).toFixed(digits)}%`;
