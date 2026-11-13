// The styles without their comments, everything else exactly as written, for the card's file: the
// comments explain the styles to whoever reads the source, and are a quarter of them. A minifier
// would take more, and also folds `backdrop-filter` into its prefixed twin, which Chrome and Firefox
// then ignore.
//
// What a comment stands for depends on where it is: nothing inside a selector, a space between two
// values. So one that sits between two characters other than spaces is refused, to be written with
// a space beside it, and every other one simply goes.
export function withoutComments(css: string): string {
  let kept = '',
    at = 0;
  while (at < css.length) {
    const char = css.charAt(at);
    if (char === '"' || char === "'") {
      const end = closingQuote(css, at);
      kept += css.slice(at, end);
      at = end;
    } else if (char === '/' && css.charAt(at + 1) === '*') {
      const end = css.indexOf('*/', at + 2);
      if (end === -1) throw new Error(`An unclosed comment in the styles, at ${at}.`);
      if (/\S/u.test(css.charAt(at - 1)) && /\S/u.test(css.charAt(end + 2)))
        throw new Error(`A comment between two characters in the styles, at ${at}: put a space beside it.`);
      at = end + 2;
    } else {
      kept += char;
      at += 1;
    }
  }
  return kept;
}

// Just past the quote that closes the string opening at `at`, or the end if none does.
function closingQuote(css: string, at: number): number {
  const quote = css.charAt(at);
  let end = at + 1;
  while (end < css.length && css.charAt(end) !== quote) end += css.charAt(end) === '\\' ? 2 : 1;
  return Math.min(end + 1, css.length);
}
