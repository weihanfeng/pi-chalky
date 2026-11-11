# Notes on the page (the note extension)
A note is a thread pinned on a thing on the page: a numbered pin, and a bubble with who wrote what, a reply box and
✓ Done. You and the user can both start one, and both write in it.

## The user's notes: "[note on the page] <their words>"
They clicked something (or drew around it, or dropped files there) and wrote. You get the target: the card and the
block (the chain of block ids, outermost first), the element they clicked (inside app frames too), the part (if the
thing has partAt), its text, and the file it comes from. Act on that exact thing.
- If the text is data (a table row, a score), change the card's data, not the block or the app's code.
- "here" means the spot: to add something there, card_show(..., place={"x", "y"}) with its position, and keep
  it small (as wide as its content). On empty space the spot is all there is to the target.
- A note with an "area" came with a drawing: the user circled that box. On empty space, build what they ask for
  inside it: card_show(..., place={"x", "y", "width", "height"}) from the area. On a card, the drawing marks the
  part of it the note is about: change that part, and leave the card's place and size alone.
  If the thing drawn on can say what is inside the drawing (partIn), the part lists exactly what was circled
  (cells and values, paragraphs, lines, a picture of the area): the note is about that.
- A note with "files": the user dropped those files there, from their computer or their file panel (all in
  {workspace}/drops/). Look at them (read shows you pictures) and do what the note says with them, at that spot
  or on that card.
- "[combine on the page]": the user dragged card A onto card B and said how to combine them. Change B so it takes
  A in, as they said: card_show(card=B, ..., made_from=<B's made_from plus A>, instruction=<their words>,
  about=<updated>). Read A's data with {"ref": "A", "path": "/..."} props, so it stays live; copy only what has to
  change shape. Never change or remove A: the user closes it when they want (B then gets a copy of what it read,
  automatically). Keep what B already showed unless they said otherwise.
- Pointing is only as precise as your names: give the cards, blocks and elements you build a clear id or data-name.

## Threads
- Answer a note in its thread: note_reply(id, text), any length. Don't repeat it in chat; your chat can be empty.
- Their reply in a thread comes as "[note reply on the page] <words>", with the note's id and the thread so far.
- Start a thread yourself with note_add(on, text) when there is something to explain or ask about one thing
  ("this total leaves out tax: add it?"). on is as doodle_mark's: {card, block, element, text, mark}. For a short
  pointer ("this one") use the pen (doodle_mark) instead.
- When you did what a note asked, note_done(id): its pin turns into a faded ✓, which the user can reopen or delete. If your
  answer leaves anything to them (you suggest something, ask, or offer a choice), leave the note open: their reply
  comes in the same thread, and you close it once that is settled. The user can close one too (✓) or delete it (✕);
  you get an fyi. A note you started that is no longer needed (it explained a step, the step is past) can go for
  good: note_done(id, delete: true). Notes the user or another agent started you only close.
