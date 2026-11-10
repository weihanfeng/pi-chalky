---
name: show-me
description: Answer "how do I…", "what does this do", "what can I do here" questions about Chalky itself by showing, not telling - circle things in your ink, then use the page's own tools in front of the user (a spare board, a test file), and hand over. Use when the user asks how to use Chalky, a tool, a button or a panel, or asks to be shown or walked through something on the page.
---
# Showing the user how Chalky works

The user learns a tool by seeing it used on their own screen. So answer a how-question by doing it on the page,
slowly, while they watch: point at the thing, use it as they would, show what came out, then let them try.
A text card or a long reply describing the tools is the thing to avoid: it is what they asked you not to do.
Don't build a tour app either: they asked about the page they have, not about what you could build.

## How to show
- **Show only what they asked about.** "How do frames work?" is one demo. "What can I do?" is a short tour of the
  toolbar, then an offer to show one tool for real. Ask nothing first: start, they can stop you.
- **Point, then act.** Before using a thing, circle it with doodle_mark, with a few words beside it. Then use it
  with page_run's helpers (interact-with-page skill): click, type, drag. They move your pointer, so the user can
  follow.
- **One step at a time.** One action per page_run, ending with a small read, so the user can follow and you see
  what happened before the next step. If a step didn't do what you expected, look (read, or screen_see) and say so.
- **One mark at a time.** Marks on things next to each other overlap (the toolbar buttons are close together).
  Clear the last mark (doodle_clear mark=<id>) before drawing the next, unless they belong together.
- **Never on their work.** Demo on a spare board (click "+" on the boards shelf) or with a test file you make.
  Don't change, move or delete their cards, files or notes to show something.
- **Hand over.** End with their turn: leave the tool on and say, in a sentence, what to do next ("drag a box on
  the empty space and type in it"). Then ask whether to keep what the demo made or remove it, and do what they say.
- **Point at what you must not press.** Rollback, Stop and deleting their things are theirs: circle the button and
  say what it does. (The page refuses a rollback from your code anyway.)
- **If they take over** (page_run says so), stop: they are trying it. When they hand back, read the page again
  before going on; they may have done the next step themselves.
- **Keep the reply short.** The page showed it. Your final reply says in two or three sentences what they saw and
  what they can try.

## The page, for showing
Names in brackets are the data-name to use in doodle_mark (on: {element: "..."}) and page_run (`[data-name=...]`).
The toolbar's order changes: find things by name, never by position.

| What | Name | What it does, and how to show it |
|---|---|---|
| Point / notes | note | Click anything (or draw around an area) and write: a note pinned to that thing, a thread with an agent. Show: on a spare board, click it, click a card, type. |
| Doodle pen | pen | Draw and write on the page, click through it, then Enter in the message line sends the drawing as steps. |
| Text | text | Words placed on the page, sent with the doodle. |
| Eraser | eraser | Takes away lines, words or unsent frames. |
| Hide marks | show-marks | Hides or shows all marks. |
| Frames | frames | Boxes the user lays out for agents to fill. Turn it on, drag a box on the main space, type in its textarea, press Implement (implement). |
| Files | files | Opens the files panel: everything in the drops folder. Clicking a row opens a preview (spreadsheets, PDF, Word, slides, pictures). |
| Microphone | dictate | Speech to text in the message line. |
| Messages / Versions | messages, versions | The left rail: the conversation; and the history of the page, with a picture of each version and Roll back. |
| Boards shelf | boards, new-board | Numbered boards; "+" makes a new one and goes to it. |
| Message line | message-line | Where the user types to the agents. Don't send messages through it. |

