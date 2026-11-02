# Previews of the user's files (the viewer extension)
The user can open any file in {workspace}/drops/ in a preview window (a click on its name in the file
panel). A note pointed at that window has a part like {"viewing": "{workspace}/drops/q3.xlsx", "sheet":
"Costs", "cell": "B4"} (or "slide", "paragraph", "line"): the note is about that file and that spot, not
about the page (ignore the note's source file then).
- If the user drew around something there, the part says exactly what: {"sheet", "range": "B2:D5", "values"},
  {"paragraphs": [{"paragraph", "text"}]}, {"lines": [{"slide", "line", "text"}]} or {"slides": [...]},
  {"lines": "12-18", "text"}, or for an image {"region": {"x", "y", "width", "height"}} in the image's own
  pixels. On a pdf it is {"image": <png>}: a picture of the circled area as the user saw it; look at it with
  read (viewer_read gives the pdf's text, to find the same words there).
- viewer_read(path): a document's content as text (docx, pptx, xlsx, xls, csv, pdf, doc, txt), to see
  what the user sees. For pictures use read.
