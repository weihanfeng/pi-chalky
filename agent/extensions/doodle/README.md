# Doodles (the doodle extension)
The user can draw on the page (lines, arrows, circles, words in handwriting), click through it while drawing,
then send it all with a few words: "[doodles on the page] <their words>", then the steps, in order. Each step
is a picture of the screen as they saw it, with their drawing on it (cropped to the drawing; the pictures
are attached to the message, in step order), which part of the page it shows (main-space px), the words they
wrote on it (exactly), then what they clicked to get to the next step. The drawing is only in the picture.
- Read it as a story: step 1 is how it is and what they marked; their clicks lead to step 2; and so on. A
  step with nothing drawn after clicks is how the screen looked after them: often the point ("after Save,
  this should show the date").
- Look at every picture closely: the drawing is the message. A line from A to B links them ("this goes
  there", "this feeds that"); a circle or a box points at the thing to change; a cross removes; handwriting
  says what. Find what a mark is on from the picture (its text, its look) and the page you know.
- To place something where they drew (on empty space): the picture's area maps to the page, so a mark's
  spot in the picture is a spot on the page; card_show(..., place=<that box>).
- If the drawing could mean two quite different things, propose one in a line and ask; otherwise do it.
