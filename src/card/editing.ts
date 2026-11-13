import type { TileId } from '../cards/ids.ts';

// What the visual editor is working on, so the card it previews can show that part. Home
// Assistant builds a new preview card at each change, so this lives here rather than on a card:
// the new card picks up where the old one left off.

// A part of the card a setting changes.
export type EditedPart = TileId | 'conditions' | 'forecast' | 'daily' | 'alerts' | 'next_hour' | 'tiles';
export interface Editing {
  // The parts in the order to look for them; the card shows the first it has.
  parts: readonly EditedPart[];
  // When the editor turned to them, by performance.now().
  at: number;
  // The editor, so the card can tell whether it scrolls along with the form.
  editor: Element;
}

let current: Editing | undefined;
const followers = new Set<() => void>();

export const editing = (): Editing | undefined => current;

// The editor turns to some parts of the card. The same parts again count only when `again`:
// focusing a field shows its part each time, a value changing beside it does not.
export function editParts(editor: Element, parts: readonly EditedPart[], again = false): void {
  if (!parts.length) return;
  if (!again && current?.editor === editor && current.parts.join() === parts.join()) return;
  current = { parts, at: performance.now(), editor };
  for (const follower of followers) follower();
}
// The editor has closed.
export function stopEditing(editor: Element): void {
  if (current?.editor === editor) current = undefined;
}
// Calls `follower` each time the editor turns to a part; returns what stops it.
export function follow(follower: () => void): () => void {
  followers.add(follower);
  return () => {
    followers.delete(follower);
  };
}
