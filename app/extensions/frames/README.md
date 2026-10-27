# Wireframes (the frames extension)
The user can lay out placeholder boxes (frames) on the page and write in each what goes there, then send
them all at once: "[frames on the UI]" lists each frame's id, place and words. Frames sent together are
one design, not separate requests: they share one look, and often each other's data.
- The words in a frame are a title, not a spec: "my notes" means a real notes app. Build what a good
  version of that thing does, the way the user would expect it from any app they know (notes are added
  and kept, a list can be added to and edited, things saved somewhere can be found there again), working
  on the page from the first version. Not the least that matches the words, and not a static mock with
  sample data where the thing should hold the user's own. Say your assumptions in one line at the end.
- Before building, look for the links: between the frames, and between them and the surfaces already on
  the page. Does one show, file, pick from, summarise or act on another's items ("book of the week" from
  "a reading list"; "my notes on what i'm reading": notes per book)? Do two hold the same things? Should a
  frame use something already there (an existing notepad) instead of starting its own? The words are short,
  so a link is often only hinted: work out what a person who drew these side by side would mean.
- If the links are not obvious, don't pick a default silently and don't ask an open question: propose
  the design and ask once, in one short reply, e.g. "Reading list: add books, mark read. Book of the week:
  Pick on a row sets it. Notes: one box for the week's book, Save files the note in that book's folder.
  Build it like that?" That reply is your answer for this turn; build when they answer. When the links are
  obvious, build straight away. Never ask about what you can decide well yourself (look, layout, details).
- Linked frames that change each other's data (pick a book, file a note into it, mark it read) are one
  app: one App folder ({code}/ui/apps/<name>/) with a page per frame (reading/list.html, week.html,
  notes.html), each frame its own surface showing its page, all keeping their data in the app's shared
  store (agents.load / agents.save, see "App data"). A click in one updates the others at once, on the
  page, with no agent in between. Separate component surfaces with {"ref"} props are for a frame that only
  shows another's data (refs only read). Don't change the page's own code (page.html, the browser.js files) to
  link frames.
- Fill a frame with ui_render(surface=<its id>, place=<its place>, ...): its dashed box goes when that
  surface appears. Keep the place: the user chose where and how big.
- Split the work when it pays: several frames that are each real work and don't depend on each other can
  go to helpers in parallel (spawn_agent, or idle agents you have): tell each one its frame, and what done
  means: "surface <id> rendered at <place>, doing <their words>". Say the shared look in each message
  (colours, type, spacing, the components to reuse), so the pieces match. A frame that needs another's data
  waits for it: hand it out once that one is done. Small or tightly linked frames: do them yourself.
- When all are filled, look at the whole page once (the pieces side by side) and fix what doesn't match,
  and try each link end to end (add a note: does it show in the filer?) by clicking through it with the
  ui-check skill.
  Put back any data your clicks changed, so the user finds what you built, not your test.
