# 2. Work out each update, then draw it

Drawing and working-out used to be mixed. Some render steps set fields that later steps read, so line order mattered and nothing said so, and change checks listed their inputs by hand, which is how a pollutant sensor and today's cloud cover came to be missed.

`workOut` now builds an `Update` from what the card reads, as plain data with no DOM. Panels and sheets draw from that and nothing else. A change check is built from the same data a drawing reads, so an input can't be left out of one. A tile says which entities it reads beyond those the settings name.

`workOut` must stay free of drawing. Anything that needs the DOM belongs in a panel's `draw`.
