---
name: show-me
description: Answer "how do I…", "what does this do", "what can I do here" questions about Chalky itself by showing, not telling - explain each thing in a note pinned on it, use the page's own tools in front of the user with your pointer (a spare board, a test file), then hand over. Use when the user asks how to use Chalky, a tool, a button or a panel, or asks to be shown or walked through something on the page.
---
# Showing the user how Chalky works

The user learns a tool by seeing it used on their own screen. So answer a how-question by doing it on the page,
slowly, while they watch: say what the thing is, right on it, use it as they would, show what came out, then let
them try. A text card or a long reply describing the tools is the thing to avoid: it is what they asked you not to
do. Don't build a tour app either: they asked about the page they have, not about what you could build.

## How to show
- **Show what they asked about.** "How do frames work?" is one demo, shown fully. "What can I do?" is a short tour:
  two or three tools, then offer the rest. "Show me all the tools" is all of them: keep each one short, one step
  per tool (below). Ask nothing first: start, they can stop you.
- **One step per tool, in a tour.** Send a tool's calls together, in one step: delete the last tool's note, pin a
  note on this tool's button, and one page_run that uses it once. For example, for Frames:
  `note_done("n4", delete: true)`, `note_add(on: {element: "frames"}, text: "Frames: drag a box where something
  should go and write what goes in it; Implement sends them to an agent. I'm drawing one now.")`, and `page_run`
  that clicks the tool, drags a box at an empty spot and types in it. A tool that is better explained than used
  (Dictate needs their microphone; Roll back is theirs to press) gets only the note.
- **Explain on the thing, in a note.** Before using a tool, pin a note on it (note_add) with a sentence or two: what
  it is for and what you are about to do. The user reads it right where your pointer goes; your text between tool
  calls never reaches the page. When you move on to the next thing, delete it (note_done(id, delete: true)) so only
  one explanation is on the page at a time. For a quick pointer without words to read ("this one"), circle it in ink
  instead (doodle_mark), and clear the mark (doodle_clear) when you move on.
- **Act with your pointer.** Use page_run's helpers (interact-with-page skill): click, type, drag, press. They move
  your pointer, so the user can follow. One or two actions per page_run, ending with a small read, so you see what
  happened before the next step. Check results with read() or a line of DOM code; look at the screen (screen_see)
  only when the look itself matters.
- **Use spots for empty space.** Tools that work on the page itself (frames, the pen, text, the eraser, Point) need a
  place, not a button: give a spot {x, y} in window px. `await drag({x: 700, y: 300}, 300, 180)` draws a frame or a
  pen stroke there, `await click({x, y})` points or places, `await type({x, y}, "words")` clicks there and types
  (into the box the click opened, or as the Text tool's words). Choose spots on the empty part of the board: first
  close a panel that covers it (messages, versions: click its rail button), then check the spot, e.g.
  `document.elementFromPoint(x, y).closest('#top') && !document.elementFromPoint(x, y).closest('[data-card]')`.
- **Never on their work.** Demo on a spare board (click "+" on the boards shelf) or with a test file you make.
  Don't change, move or delete their cards, files or notes to show something.
- **Hand over, then tidy.** End with their turn: say in a sentence what to do next ("drag a box on the empty space
  and type in it"), with the tool left on for them. Delete your explaining notes and clear your marks. Leave no
  other tool on. Then ask whether to keep what the demo made (the board, the test file, a frame) or remove it, and
  do what they say.
- **Point at what you must not press.** Rollback, Stop and deleting their things are theirs: put a note on the
  button saying what it does. (The page refuses a rollback from your code anyway.)
- **If they take over** (page_run says so), stop: they are trying it. When they hand back, read the page again
  before going on; they may have done the next step themselves.
- **Keep the reply short.** The page showed it. Your final reply says in two or three sentences what they saw and
  what they can try.

## The page, for showing
Names are the data-name to use in note_add / doodle_mark (on: {element: "..."}) and page_run (`[data-name=...]`).
The toolbar's order changes: find things by name, never by position.

| What | Name | What it does, and how to show it |
|---|---|---|
| Point / notes | note | Click anything (or draw around an area) and write: a note pinned to that thing, a thread with an agent. Show: click the tool, click a spot on a thing, type, Enter. |
| Doodle pen | pen | Draw and write on the page, click through it; Enter in the message line sends the drawing as steps (don't send it). Show: click the tool, drag at a spot. |
| Text | text | Words placed on the page, sent with the doodle. Show: click the tool, type at a spot. |
| Eraser | eraser | Takes away lines, words or unsent frames. Show: click the tool, drag over what you drew. |
| Hide marks | show-marks | Hides or shows all marks. |
| Frames | frames | Boxes the user lays out for agents to fill. Show: click the tool, drag a box at a spot, type in its box, then Implement (implement) sends them to an agent. |
| Files | files | Opens the files panel: everything in the drops folder. A row dragged onto the page opens a note there; a click opens a preview (spreadsheets, PDF, Word, slides, pictures). An empty folder shows an empty panel: write a test file into it first. |
| Microphone | dictate | Speech to text in the message line. |
| Messages / Versions | messages, versions | The left rail: the conversation; and the history of the page, with a picture of each version and Roll back. |
| Boards shelf | boards, new-board | Numbered boards; "+" makes a new one and goes to it. |
| Message line | message-line | Where the user types to the agents. Don't send messages through it. |
