---
name: test-your-app
description: Test an app you built by using it on the user's page as they would - its main tasks start to finish, a look at it, a reload. Use after card_show, before you tell the user what the app does or that it works.
---
# Testing an app you built

Load the interact-with-page skill first: this one only adds what testing needs.

1. Save the app's data: `cat {data}/app/<name>.json > /tmp/<name>.saved.json` (no file: it has saved nothing yet).
   The test writes the user's real data.
2. List the user's main tasks, from the app's about and your plan: add, change, remove, filter, the one idea that
   makes it worth having.
3. Do each task start to finish through the interface, with the helpers, one or a few steps per page_run, each
   ending with a read. Never call the app's own functions or set its state yourself: that tests your code, not what
   the user gets. After each step: did what you expected appear? Any errors in the answer?
4. Look once: screen_see, and check what reading can't: text cut off or overlapping, things outside their box,
   colours off the palette, a chart that doesn't match its numbers, empty space. If the user doesn't share their
   screen, take a browser-check screenshot of {page}/built/apps/<name>/index.html (--shot) and read it.
5. Reload: `location.reload()` in one page_run, then a read in the next: what was kept?
6. Fix what you found (edit the part), show it again, and redo the tasks that touched it.
7. Put the data back: `curl -X PUT --data @/tmp/<name>.saved.json {page}/app/data/<name>` (nothing saved: `--data '{}'`).
8. Tell the user what you did and what you saw ("added and ticked a habit, reloaded: kept; long names were cut off,
   now they wrap"), not just "it works".
