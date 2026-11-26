# Cards (the card extension)
A card is one thing you show the user on a board in the page's main space: a form, a table, a dashboard, a game.
It shows either blocks (pieces described as JSON) or an app (a page you write). Prefer a card over editing the page
({agent}/extensions/page/page.html). Aim for one screen; make it scroll only if the user asks.
A card shows only what you build, with no frame: when asked for a thing (a smiley, a chart), show just that thing.
Add a background, border or Panel only if the thing itself needs one. An app's page should keep a transparent
background, so it sits on the board.
Name what you build (a clear card id, block ids, ids or data-name on elements): the user points at things by name.
Blocks or an app? What the user clicks never wakes you, so the page must do everything a click should do:
- Blocks (card_show with blocks), when clicks and typing only store a value: the layout is fixed, the user types,
  picks, ticks or switches tabs (Button set, when, bindings), and you read the data when they next write. Status,
  tables, summaries, forms, settings, a fixed checklist, a dashboard you fill in.
- An app, when the page must work something out or change its own shape while the user uses it: compute a value
  (a total, a streak, a score), add or remove items, follow rules or time (a game, a timer), draw (a chart).
  Trackers, calculators, games, editors, charts.
The test: if a click or keystroke should change anything other than the value it sets, it is an app. Blocks
can't append to a list or calculate; a Button only writes the fixed value it was given.
A new block is for one part blocks can't do yet that many cards will reuse; then use it from JSON.
Before building or restyling what the user sees, load the design skill (how it should look and read).
- card_blocks (load it with tool_search): lists the blocks and their props. Read it first.
- card_show(card, blocks, data): show a card, or replace it. blocks is a flat list; each has "id", "block" (its
  kind, a name from card_blocks), its props, and "children": [ids] or "child": id. One has id "root".
  A prop can be {"path": "/x"} to bind it to this card's data (inputs write to it), or
  {"ref": "other-card", "path": "/x"} to read another card's data live (no copy: it follows changes).
  Any block can have "when": {"path": "/x", "is": value}: hidden while the data there is something else.
  Tabs: Buttons with "set": {"/tab": "today"} etc., and one block per tab with "when": {"path": "/tab", "is": ...};
  start the data with the first tab ({"tab": "today"}). Errors come back to you; fix and retry.
- card_show(card, app=<name>): the card shows that app, then says what it found on the board (errors, and whether
  it fits its card): fix what it reports. Write the page first, in
  {built}/apps/<name>/index.html (its other files next to it); the app extension's README says how an app keeps
  its data and talks to the agents. height: its height in px when nothing else sizes it (default 400).
- about="...": one or two sentences on what the card is for and why it is built this way. The user reads it on
  the card's back side; you read it in {built}/card.json. Keep it true when you change things.
- options=[{"label", "blocks" or "app", "data"}, ...] instead of blocks or app: when you are not sure what the user
  meant, offer 2-3 versions; they flip through them and keep one.
- Pinned cards (the user held their label): your card_show, card_update and card_remove on them fail. Don't work
  around it: make a new card (made_from=[the pinned one]) or ask the user.
- Cards stack in the main space and are as wide as their content. place={"x", "y", "width"?, "height"?}
  (px from the main space's top-left) pins one at a spot instead: use it when the user points at a spot ("here")
  or draws an area (then fill that area: its x, y, width and height).
- Everything you show is draggable by default: the user moves a card by its label (shown on hover), or anywhere on it with ⌘ (Ctrl) held, and it stays
  where they put it (card_show without place keeps it there; where things are now: the "place" of each card in
  {built}/card.json). Pass draggable=false only when the user wants something fixed. In an app you build, make
  separate pieces draggable too, unless told otherwise.
- Everything you show is resizable by default too: the user drags its bottom-right corner (shown on hover), and
  the card's root block (or its app) fills the new size. So build things that fill their space (sizes in %, flex,
  or scaled to their box, e.g. an SVG with a viewBox), not fixed px. Pass resizable=false only when the user wants
  a fixed size.
- card_update(card, path, value): change data only (fast; blocks keep their state). With block=<its id>, path is a
  prop of that block (e.g. a label's text): a small fix without card_show. card_show without data keeps the card's
  data. card_remove(card) takes it off its board.
- Data (what users typed, rows, scores) is kept in {data}/card.json (not versioned); the rest of each card in
  {built}/card.json. The user can undo any change (theirs or yours), so don't keep backups.
- A Button's click writes its set ({path: value}) into the card's data on the page; you are not woken, and you
  see the data in {data}/card.json. A row of Buttons setting the same path works as tabs.
- Voice input (dictation, meeting notes): import /voice/voice.js in the app (read its header), never the browser's
  speech API or a provider directly: it uses the sandbox's speech-to-text API, or the browser's.
- A new block: {agent}/extensions/card/blocks/<Name>.js. Start with a comment line "// Name: what it does" (more
  comment lines if needed), then its about block, then
  `export default class extends HTMLElement { update(props, card) {...} }`.
  The about block of a block (strict JSON after `export const about = `):
    "version": 1             the shape of its props; raise it when they change, and export
                             upgrade(props, fromVersion) -> props, so cards saved earlier still draw
    "props": {"name": {"type": "text" | "number" | "boolean" | "choice" | "list" | "rows" | "object" | "action",
                       "options": [...] (for choice), "default": ..., "doc": "what it is"}}
    "children": "none" | "one" | "many"
    "levers": ["Shown as {variant}."]   the back side: plain sentences; each {prop} becomes a control the user
                             can change there (choice and boolean cycle, text and number are typed)
    "accepts": "rows with a number column"   optional: what it can take when something is dropped on it
    "example": {...props}    one sample, for the catalog and for checks
  update() runs on every change, on the same element: keep internal state there (e.g. a game loop).
  card.children: child elements, placed with card.mount(container); card.set(prop, value) writes a bound prop;
  card.data is the card's data and card.write({path: value}) changes it (saved, you are not woken).
  card.action(name, context) sends an action to you and wakes you: only for what truly needs you (e.g. "ask the
  agents"), never for clicks the page can handle. Make it general so it can be reused. New blocks work
  immediately; edited blocks and app files show when your turn ends (the page refreshes itself).
  Pointing inside a canvas: give the element (or an app page's window) a partAt(x, y) function returning
  {"name", ...} for what is at that spot, so the user can point at parts (an enemy, a cell).
- Agents inside what you build (a simulation's members, a debate, characters): load the app-agents skill first.
  They are real agents that belong to the app, not workers helping you build it.
- Libraries: blocks import marked and dompurify by name (import { marked } from "marked"), as mapped in the import
  map at the top of {agent}/extensions/page/page.html. To add one, put its ES-module build in
  {agent}/extensions/card/lib/<pkg>/ and import it by path (/card/lib/<pkg>/<file>.js).
- Block pitfalls (you can't see the browser, so avoid them up front):
  keep your own state in one object, this.state = {...}: fields like this.dir, this.title, this.hidden,
  this.id, this.style, this.lang are built-in HTMLElement properties and silently break;
  set a canvas's width/height BEFORE drawing (resizing clears it); don't create things twice in update();
  remove document-level listeners/timers when the element is no longer connected.
