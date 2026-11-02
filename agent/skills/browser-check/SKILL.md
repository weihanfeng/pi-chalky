---
name: browser-check
description: Check a web UI in a real headless browser - JavaScript errors, failed requests, clipped or overflowing elements, how it looks, and whether clicks and keys work. Use after changing anything the user sees (the page, blocks or cards, an app you built) and before calling UI work done.
---
# Checking a UI in a headless browser

Reading the code back doesn't show what the user sees: the page is built when its scripts run, and
layout only exists once the browser has computed it. So check UI work by running it.

## 1. Run the check
From this skill's folder (paths here are relative to it):
```
node scripts/check.mjs URL [STEPS ...] [--size 1280x800] [--shot /tmp/ui.png] [--full]
```
- URL: the user's page is `{page}/`. An app you built is served by it too
  (`{page}/built/apps/<name>/index.html`); any other file: `file:///<full path>`.
- Steps run in order after the page loads (it gets 1.5 s first):
  `wait:500`, `click:#pause`, `drag:#card=200,0`, `altdrag:#top=-150,0` (Alt held), `hold:.label=800` (press and hold),
  `dblclick:.label`, `type:#message=hello`, `key:Enter`, `eval:document.querySelectorAll('.agent').length`,
  `shot:/tmp/after.png`, `dialog:accept` (`node scripts/check.mjs --help` lists them).
- confirm()/alert()/prompt() dialogs are answered for you and reported (`dialog confirm "Stop agent3?" -> dismissed`).
  Default is dismiss (Cancel). Put `dialog:accept` (or `dialog:accept=TEXT` for a prompt) before the click
  whose dialog you want to accept.
- It prints errors (uncaught exceptions, console errors, failed requests), layout problems (an element
  cut off by a box that hides overflow, an element sticking out of the window, cut-off text, sideways
  scrolling), each step's result, and the screenshot path. Exit code 1 means a step failed or there were
  errors. Layout problems don't change the exit code: judge each one (a decoration meant to bleed off the edge
  is fine; a cut-off button isn't).

Example: did the map fit, and does pause work?
```
node scripts/check.mjs {page}/ \
  "eval:getComputedStyle(document.querySelector('#map')).height" click:#pause \
  "eval:document.querySelector('#pause').textContent" --shot /tmp/ui.png
```

## The browser
The check needs a headless browser. It uses $CHROME if set, else one downloaded before, else an installed
Chrome, Chromium or Edge. If none is there it stops (exit code 2) and prints a download command with pinned
versions: run exactly that command once (about 270 MB on disk; later runs reuse it), then run the check again. Only
download when the check says none was found. If the download fails (no network, no space), tell the user what
the error said; don't try other browsers or versions.

## 2. Read the report, fix, run again
- Fix every error and layout problem, or say in your evidence why one is fine.
- Check at the size users have (1280x800) and a narrow one (`--size 390x844`) if the layout should adapt.
- `eval:` is how you check state precisely: counts, text, sizes, a value your code exposes.

## 3. Look at it
The layout check sees elements, not pixels: a sprite drawn on a canvas, colours, contrast, overlapping
drawings, whether it looks right at all - those need eyes. Take a screenshot (`--shot`) and look at it
with `read(path)`, then check what you were looking for ("are all five agent sprites fully inside the map?
is any text unreadable?"). Look after a real change, not after every run: each image stays in your
conversation and adds to every later call.

## Careful: the page is live
`{page}/` is the real page connected to the real agents. A click or a typed message
there really happens: sending a message wakes an agent, Stop stops everyone, rollback changes
code. Click only what you mean to test, prefer pause/resume over stop, and test destructive controls
on a copy (a replay, or your own test page), not on the live system. Dialogs are dismissed unless
you say `dialog:accept`, so a "Stop agent3?" confirm only acts when you mean it to.

## Good evidence for "done"
The command you ran, its counts ("0 errors, 0 layout problems at 1280x800 and 390x844"), what the
eval steps returned, and what you saw in the screenshot.

## Pitfalls
- `type:` splits at the first `=`: use a selector without one (`block-textfield input`, not `[data-card=x] input`).
- `querySelector` doesn't reach inside a shadow root; use `eval:` with `el.shadowRoot.querySelector(...)`.
- Content that arrives over the WebSocket may need `wait:1000` before you check it.
- Chrome starts fresh for each run (no cookies, no storage); each run takes a few seconds.
