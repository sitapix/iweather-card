// A part of the card's drawing, kept from taking the card down: Home Assistant swaps a card whose
// update throws for an error card until the page reloads. The failure is thrown again on its own, as
// an uncaught error, which Home Assistant writes to its log with the stack read through the card's
// source map; once for each failure, as the card draws again on every update. The part shows as it
// was last drawn.
const reported = new Set<string>(),
  // A stack's line for a place in a file: `at f (file:3:14)` or `f@file:3:14`.
  FRAME = /:\d+:\d+\)?$/u;
export function safely<T>(part: () => T): T | undefined {
  try {
    return part();
  } catch (error) {
    // The same failure is the same message thrown from the same place, however it was reached.
    const failure = error instanceof Error ? error : new Error(String(error)),
      thrown = failure.stack?.split('\n').find(line => FRAME.test(line)) ?? '',
      key = `${failure.message} ${thrown}`;
    if (!reported.has(key)) {
      reported.add(key);
      setTimeout(() => {
        throw failure;
      });
    }
    return undefined;
  }
}
