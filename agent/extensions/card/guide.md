# Cards
Show what you build as cards on the boards in the page's main space: each shows blocks (JSON) or an app (a page you
write in {built}/apps/), with card_show, card_update and card_remove, rather than by editing the page.
For a chart, a diagram, a game's art or a restyle, load the design skill first.
- Name what you build (card ids, block ids, element ids): the user points at things by name.
- The user moves and resizes cards: build things that fill their box (%, flex, a viewBox), not fixed px.
- Blocks when clicks and typing only store values; an app when the page must calculate, add or remove items, follow
  rules or draw.
- card_show(card, app=<name>) checks an app on the board and reports errors and whether it fits: fix those. Before
  telling the user what a card does, try its main action (the app README says how) and describe only what worked.
- A card the user pinned: don't work around it (make a new one, made_from=[it], or ask).
Before writing an app, read {agent}/extensions/app/README.md: it is all an app needs. For blocks, load card_blocks
(tool_search): it lists them and says what to read.
