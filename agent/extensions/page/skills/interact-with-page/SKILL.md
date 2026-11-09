---
name: interact-with-page
description: Use the page the user has open the way they would, while they watch - read what's on screen, click, type, press keys, drag - in any card, app or part of the page. Use to check what the user sees, show them something, fill something in for them, reproduce what they pointed at, or try something you built.
---
# Using the user's page

The page_run tool (load it: tool_search "page_run") runs JavaScript in the page the user has open, as it is right
now. With card=<id> it runs inside that card's app: `document` is the app's page. The code is the body of an async
function: `await` works, and you `return` what you want back.

## Act with the helpers
They act as a person would: your pointer moves to the thing first, what you touch gets an outline with your name,
and typing goes letter by letter, so the user can follow.
- `await click(t)`
- `await type(t, text)`: replaces what the field holds (`{add: true}` adds to it). A dropdown picks the option with
  that text; a slider, date or colour field is set to that value.
- `await press(key, t?)`: Enter, Escape, Tab, ArrowDown, "Ctrl+z"... to t, else to what has focus. Enter in a form
  field submits the form.
- `await drag(t, dx, dy)` by pixels, or `await drag(t, other)` onto another thing.
- `read(t?)`: what's on screen as short lines: headings, controls with their value and state ([selected],
  [checked], [disabled]), short texts. Only what's in view; `read(null, {all: true})` for the whole page.
- `await wait(ms)`, `await wait(".row.new")` (until it appears), `await wait(() => condition)`.

t is an element, a CSS selector, or the visible text: a button's words, a field's placeholder or label.
```
page_run(card="habit-tracker", code=`await type("New habit", "Drink water");
  await click("Add habit");
  return read()`)
```
Plain DOM code is fine for reading and checking precisely: `getComputedStyle(el)`, `el.scrollWidth > el.clientWidth`
(text cut off), state the app exposes. For acting, use the helpers: a bare `el.click()` happens at once, and the user
only sees an outline afterwards.

## Look after each step, cheaply
One step, or a few, per page_run, ending with a small read: `return read()` or the one value you need. You see what
happened before you decide the next step. A read is about a hundred tokens; a picture (screen_see) is over a thousand
and stays in your conversation, so look at a picture when the look matters (layout, colours, clipped or overlapping
things), not after every step. From bash the same is `curl -X POST --data '{"code": "...", "card": "<id>"}' {page}/page/run`,
for a loop or a script.

## The user is watching, and can take over
While you use the page a bar says so, with a Stop button. If the user clicks or types on the page, page_run answers
"the user took over": stop there, don't retry, and say in a sentence what you were doing. When they press
"Let <you> continue" you get a message: read the page again first, it may have changed.

## Care
- It's the live page: clicks really happen and data really changes. Touch only what your task needs, and don't send
  messages through the chat box.
- The page's Stop button and rollbacks refuse code: they are the user's.
- Events from code are not quite real input: hover styles, native dropdown lists, file pickers, copy and paste, and
  HTML drag-and-drop (draggable) don't respond. For those, and for other window sizes, use the browser-check skill
  (a separate headless browser).
- Errors the page logs while your code runs come back with the answer: read them.
- An answer marked "not on the board the user is looking at" ran on a card they can't see right now.
