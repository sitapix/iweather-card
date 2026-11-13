# 4. Files beside the card

Home Assistant loads a dashboard resource on every dashboard, whether or not it shows the card, so the card's file costs everyone everywhere. Three pictures in base64 made up half of it and most of its compressed size, as base64 barely compresses, and MapLibre came from a public CDN when a map opened.

**The pictures, the languages and MapLibre stand beside the card's file** and are asked for by address when needed. HACS and Home Assistant's Marketplace install every asset of a release, and write a `.gz` beside each `.js`, so the card's file went from 729 KB compressed to 218 KB, and a map no longer needs a third party to reach a library.

**What it costs.** A manual install is several files rather than one, and a card with some missing has to carry on without them. An update replaces files a browser may hold for 31 days, so each carries its hash or version in its name.

**The editor stays in the card's file.** Split naively, its chunk would import from the entry, and the entry's address carries the installer's version, so the chunk would load a second copy of the card. That can be got round: the public file can be one line that re-exports a hashed one, which chunks import instead, or the editor can be an entry of its own that copies the card's query onto its own address. Neither was taken, as the editor is some 50 KB of source, and each adds a file that may not come, and a stale one an update leaves behind. Languages are data, so they split without that. A page reads English until its language has come, which is the time one small file takes, and then draws again.

**The build holds to this.** `vite.config.ts` fails a build whose card file holds anything in base64, MapLibre or a translated sentence, or has grown past a set size, which is raised by hand. Languages stand beside the card as `.js`, as installers compress only that, and the styles reach the card's file without their comments, a quarter of their size.
