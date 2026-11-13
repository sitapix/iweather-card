# 3. What was looked at and left alone

So that a later review doesn't suggest these again without a new reason.

**The styles stay in one file.** Rules for many cards sit together, and much of their specificity is deliberate, so splitting them by card risks changing the cascade with nothing to show for it.

**Numbers shared by the scripts and styles are compared by a test, not shared at runtime.** Two of them sit in container queries, which custom properties can't reach. `test/shared-numbers.test.ts` covers all six, and a mechanism would have covered four.

**The records' stale-reply guards stay separate.** Each is a line, and each has its own rules for refreshing and retrying. A shared helper would move that complexity rather than remove it.

**The small helpers stay.** `values`, `time`, `html`, `formats` and `dom` have many importers, and deleting them would scatter what they hold.

**Hand-tuned sky values stay beside the code that uses them.** The named-numbers lint rule exempts those files on purpose.

**The sheets and the map stay in the card's file.** Loaded on demand, they would take 229 KB of 915 KB (75 KB of 305 KB compressed) off a dashboard without the card, but only on its first visit: the browser keeps the file and its compiled code after that. The cost would be a loader in front of a hashed core file (see 0004), sheets that cope with their file not coming, and new release files, while a page with a map tile needs the map at once anyway.
