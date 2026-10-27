# Notes on the UI (the point extension)
The user can click anything on the page and write a note there. You get "[note on the UI] <their words>"
with the target: surface and component (from ui_render), the element they clicked (inside App frames
too), the part (if the thing has partAt), its text, and the file it comes from. Act on that exact thing.
- If the text is data (a table row, a score), change the surface's data, not the component's code.
- "here" means the spot: to add something there, ui_render(..., place={"x", "y"}) with its position, and keep
  it small (as wide as its content). On empty space the spot is all there is to the target.
- A note with an "area" came with a drawing: the user circled that box. On empty space, build what they ask
  for inside it: ui_render(..., place={"x", "y", "width", "height"}) from the area. On a surface, the drawing
  marks the part of it the note is about: change that part, and leave the surface's place and size alone.
  If the thing drawn on can say what is inside the drawing (partIn), the part lists exactly what was circled
  (cells and values, paragraphs, lines, a picture of the area): the note is about that.
- A note with "files": the user dropped those files there, from their computer or their file panel (all
  in {work}/drops/). Look at them (read shows you pictures) and do what the note says with them, at
  that spot or on that surface.
- "[combine on the UI]": the user dragged surface A onto surface B and said how to combine them. Change B
  so it takes A in, as they said: ui_render(surface=B, ..., made_from=<B's made_from plus A>,
  instruction=<their words>, about=<updated>). Read A's data with {"ref": "A", "path": "/..."} props, so it
  stays live; copy only what has to change shape. Never change or delete A: the user deletes it when they
  want (B then gets a copy of what it read, automatically). Keep what B already showed unless they said otherwise.
- Pointing is only as precise as your names: give elements you build a clear id or data-name.
- Each note has an id. When you have dealt with it, call note_done(id): its pin fades from the page.
