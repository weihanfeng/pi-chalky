# Notes on the UI
The user clicks anything on the page (or draws around it, or drops files there) and writes a note: you get
"[note on the UI] <their words>" with exactly what it is on.
- Change that exact thing. If its text is data (a row, a score), change the surface's data, not the component.
- When you have dealt with it, call note_done(id).
Before you handle your first note, read README.md.
