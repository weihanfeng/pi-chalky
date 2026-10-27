# Notes: Chalky agent on pi (test, 2026-10-27)

Question: can the Chalky agent run on pi, with plugins as native pi extensions, the page unchanged?

## Layout
- `server.ts`: the host, the fixed core agents can't edit: one pi `AgentSession` per agent, the WebSocket `/ws`, route
  lookup for what extensions add, pi's events handed to extensions (host.eventHandlers, host.connectHandlers), and
  `/recover` (the safety net). Serves no page itself.
- `app/`: agent-editable, versioned, and pi's agentDir. Everything is an extension, and one extension is one folder,
  `app/extensions/<name>/`: `index.ts` (pi loads it), and as needed `guide.md` (prompt text), `browser.js` (its part
  of the page), `skills/` (given to pi with `resources_discover`), other files (`ui/components/`, `page/page.html`).
  The page itself is the `page` extension. `app/skills/`: skills about the agent as a whole (plugin-map,
  write-skill). `app/ui/`: what the agents built (`surfaces.json`, `apps/`), gitignored.
- `state/`: pi session files (`state/sessions/<agent>/*.jsonl`), ui data, version history. `state-run1/`,
  `state-run2/`: earlier test runs.
- Run: `MODEL_BASE_URL=http://127.0.0.1:4000/v1 MODEL_API_KEY=<LiteLLM key> node server.ts`, then `tests/say.mjs`.
- Browser tests: run a headless Chrome with its DevTools port, e.g. the one ui-check downloaded:
  `~/.cache/chalky-browsers/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell
  --no-sandbox --hide-scrollbars --user-data-dir=<tmp> --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1
  about:blank` (or the agent-py:0.90 image's), then `node tests/browse.mjs out.png '<js: body of an async function>'`
  (opens the page, runs the js, screenshots; CDP).

## Versions
- Node 24.5.0. `@earendil-works/pi-coding-agent` 1.4.0 (pi-ai, pi-agent-core 1.4.0), `ws` 8.22.0 (exact).
- Page libraries as in chalky-agent: marked 18.0.14, dompurify 3.4.16.
- Viewer (exact): xlsx (SheetJS) 0.20.3 from https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (sha512 in the
  lockfile), mammoth 1.13.0 (docx), node-pptx-parser 1.0.1 (pptx), word-extractor 1.0.4 (doc), unpdf 1.9.1 (pdf text).
- Versions plugin: isomorphic-git 1.44.2, dom-to-image-more 3.11.0 (exact). ui-check browser download (only if none found): @puppeteer/browsers 3.2.4,
  chrome-headless-shell 155.0.8059.84.

## Tested (through LiteLLM -> openai-oauth)
1. Chat through the page protocol: answer "pineapple".
2. ui_catalog / ui_render; user's ui_move saved; pi found Chalky's skills and the agent read ui-design first.
3. Swarm: spawn_agent agent2, ask_agent -> "42".
4. Server restart: both agents back from pi's session files, remembered both answers.
5. Self-edit: agent wrote app/extensions/hello.ts, reload, then used hello_pi.
6. Real browser (headless Chrome from agent-py:0.90): page unchanged, history replayed, card drawn.

## Step 1: pi's own mechanisms for the core (2026-10-27)
Rule from here on: keep the page and the features; on the backend use pi's way where it is better.
- Record: no log.jsonl. The page replays pi's session files (`sessionManager.getEntries()`); compaction keeps the
  original entries, so the page still shows everything. `reply_to` comes from the "[kind from X]" header.
- Compaction: pi's own (on by default): when a request would leave less than 16384 tokens of the model's window.
  `MODEL_CONTEXT_WINDOW` (model.ts) replaces COMPACT_AT_TOKENS. Summaries are structured ("## Goal ...").
- Notes to a busy agent: pi `steer()`, delivered between its tool calls in the same turn. Messages and questions
  still wait for a turn of their own in the host's list (pi `followUp()` would join them into one run, and each
  answer has to go back to its own sender).
- Step limit: extension steps.ts (`MAX_STEPS`, default 30): counts turn_end per input, then `ctx.abort()`.
  pi records that stop as stopReason "error", "This operation was aborted".
- Tested (window 40000, MAX_STEPS 5): replay of 21 then 71 messages from session files; stop after 5 of 8 steps;
  a note from agent2 reached agent1 right after its 20 s command, same turn ("mango"); compaction at 30472 tokens
  mid-turn, the answer went on, the page kept every message, the agent still knew "mango" and hello_pi's output.

## Step 2: the full swarm (2026-10-27)
- swarm.ts is a port of swarm.py: kinds (message, question, note, reply, fyi), chains, limits, deadlock check, ask
  timeout, app agents, reset_agent, list_agents, the team prompt (swarm.team.md, copied verbatim). The inbox moved
  out of the host; the host keeps sessions, the page, and `host.prompt(agent, text, replyTo)` (one run, then a reload
  the agent asked for). Extensions offer services in `host.api` (the swarm: send, status, stop, reset).
- On pi: notes/replies/fyis for an agent mid-turn: `steer()`; an fyi for an idle agent: `sendCustomMessage()` (filed,
  the model sees it next turn); reset: a new pi session file (the old ones stay; the page replays all of them).
  Stop: `abort()`; pi closes the cut-off tool call itself ("Command aborted"), so close_tool_calls isn't needed.
  Restart drain isn't needed: pi reloads one agent in the process, after its turn.
- Who a turn's answer goes to (the page's `reply_to`) is saved as a pi custom entry "chalky.turn" (not seen by the
  model), and set only on the message that starts the turn, as in the Python harness.
- Tested: tell -> note -> reply chain back to the user (12*12 = 144; the reply came while agent1 was still in its
  turn, so steer() delivered it there); ask_agent with "waiting on agent2" status and the deadlock refusal; reset
  (new session file, no memory, both rounds on the page); Stop mid-command, then the agent answers again.
- Also tested: an fyi to an idle agent (filed as a pi custom_message, no turn started, the agent knew it later);
  app_message from the page to an app agent (npc1 of app "game"), one to an unknown agent (error on the page);
  app_reset (new session file; npc1 no longer knew the name it was told).
- Not tested: the 600 s ask timeout, the limits. Not ported: images with
  messages (doodle), the tasks plugin's blocked state. A process restart still loses queued items (as before).
- Shared state (host.shared) survives a reload; the code acting on it is the newest load of swarm.ts.

## Step 3: page plugins, one at a time (2026-10-27)
Pattern (same as ui): an extension registers its tool(s), its routes and page script (the browser half from
../chalky-agent/plugins, unchanged), a page-message handler, and its guide as a prompt section (copied verbatim).
- point.ts: note_done; /point/point.js, /point/notes; point_note, point_combine, point_dismiss; state/notes.json.
  Guide change: "read shows you pictures" (pi's read) instead of view_image.
  Tested: a note on a table cell (pinned n1, ui_update, note_done, pin faded); a combine (made_from and
  instruction recorded); closing a note while its agent was busy (steer() delivered "the user closed n3").
  The pencil button shows in the palette (headless Chrome).
- Found (also in the Python agent): the agent put {"ref"} links inside rows; ui.js resolves refs only as whole props,
  so the column showed [object Object]. Decided: later (ui_render could reject refs that aren't a whole prop).
- Fixed: a note closed before its turn started still ran as a turn. Now point takes it back out of the inbox
  (swarm `withdraw(item)`), and tells the agent only if its turn had started.
- files.ts: /files, /files/upload (POST, 25 MB), /files/files.js; the list goes to the pages after uploads and when an
  agent's turn is over (pi agent_settled); guide: "read shows you pictures".
  Tested: upload, name clash (fruit-2.csv), unsafe name cleaned, over 25 MB refused (413); a note with a dropped CSV
  and PNG: the agent read both, pi's read gave the model the picture (total 21, "red"); the agent saved totals.csv
  and the panel listed it; the panel shows on the page (headless Chrome).
  No vision plugin needed: pi's read returns images.
- Bug found and fixed: cutting off an oversize upload crashed the whole server (an unhandled stream error). The host
  now catches errors nothing handled (logs them, shows them on the page), as aiohttp did for the Python plugins:
  without start.sh, one mistake in any extension (also one an agent writes) would stop everything.
- viewer, library research: pi's read does text and images only, so docx/pptx/xlsx/pdf need libraries.
  Chosen: SheetJS (xlsx, xls, csv, tsv in one), mammoth (5M downloads/week; its transformDocument tree has style
  names, numbering, tables), node-pptx-parser (user's pick; README shows text per slide only, so titles, tables
  and notes still to check), word-extractor (.doc), unpdf (no deps). .ppt: no preview (only catppt, a Linux program).
  Rejected: npm's xlsx 0.18.5 (2 high advisories, no fix on npm: SheetJS publishes only on its own site);
  officeparser (~66 MB with pdf.js, fetches from a CDN by default); pptxtojson (no title flag, text as HTML);
  read-excel-file (xlsx only). Later idea: docx-preview / pptxtojson could draw real-looking pages in the browser.
  Packaging note: installing Chalky will also download SheetJS from cdn.sheetjs.com.
- viewer.ts, part 1: /viewer/viewer.js, /viewer/raw (images, pdf; svg sandboxed), /viewer/shot (png, 10 MB, to
  state/pointed), /viewer/view for sheets (SheetJS read(buffer); the ESM build needs set_fs only for file APIs) and text.
  Rows always start at A1 (viewer.js names cells by position). Cells show Excel's formatted text ("1,234.50", "25%",
  dates): the Python version showed raw values ("1234.5"). csv/tsv read with raw: true, so "007" stays "007".
  Tested: xlsx from openpyxl (data from B3, number formats, date, 3 sheets, cut at 1000 rows / 60 columns, empty
  sheet), xls (written by SheetJS: nothing else here writes BIFF), csv (BOM, quotes, comma in a cell, 007, José, ✓),
  tsv; a path outside drops, ../ and a symlink out all 404; raw refuses xlsx; shot refuses non-png.
  Browser: costs.xlsx opens in its window with the tabs Costs / Notes / Empty, "Item" in B3.
  A formula without a saved value (openpyxl never computes) shows empty, as in Python.
- files.ts: files inside folders in drops are listed too, named by their path inside drops ("preview-samples/x.docx"),
  newest 500, hidden files and folders skipped (user's report: a folder's files never showed; Python did the same).
  files.js unchanged; long names are cut off in the panel (full path on hover).
- viewer.ts, part 2: docx (mammoth's tree, kept from transformDocument) and pptx (node-pptx-parser's parse()).
  Found: Word stores built-in style names lower case ("heading 1"); python-docx renames them, mammoth doesn't
  (so matched case-insensitively). node-pptx-parser: slides come in the links file's order (put in presentation.xml's
  order here); extractText skips tables, groups and titles (we walk the XML trees ourselves); it never opens the
  notes files, so no speaker notes. xml2js groups children by tag, so shapes of different kinds lose their order.
  Tested against the Python viewer's own preview() (agent-py:0.90, python-docx 1.2.0, python-pptx 1.0.2) on the same
  files: report.docx (Title, Heading 1/2, bold run, bullet and numbered list, table with merged cells, tab) the same;
  deck.pptx (title slides, bullets, a table, a group, notes, slides reordered) the same except: we also show the
  group's text (Python missed it), and no notes. The agent-made sample.docx / sample.pptx: the same.
- Decided (user): speaker notes left out for now (later: read ppt/notesSlides/* ourselves, e.g. with unzipper, which
  node-pptx-parser already uses). .ppt: no preview. Old .doc: kept after all (word-extractor was installed anyway).
- viewer.ts, part 3: .doc as text (word-extractor); the tool read_document (Python's read_file, renamed so it isn't
  confused with pi's read): the preview as text, pdf pages with unpdf, 40,000 characters; the guide (viewer.guide.md,
  copied verbatim; swapped in code: the folder, read_document, "read" for pictures, no ppt).
  Tested: test01.doc from word-extractor's repo (tag 1.0.4; emoji and symbols kept); its broken-header .doc shows
  "Could not read this file" (server fine); a 2-page pdf printed by headless Chrome.
  Agent turn: read_document on the pdf, xlsx, pptx and doc, all answered right (Apple 1,234.50 in C4, page 2 text,
  the group's text, the emoji). A note pointed at cell C4 in the viewer (the part viewer.js sends): the agent read
  the sheet, answered "C4 shows 1,234.50, the item is Apple", and called note_done.
  Not tested here: drawing around an area of a pdf (the page captures its own tab: needs a real browser and a person).
- ui_history.ts (undo, redo, Alt-drag rewind; ui_history.js unchanged). pi has no undo for the page: /tree and
  /fork rewind one agent's conversation; the git-checkpoint example saves code per turn (for `versions` later).
  ui.ts: change(sid, record, by, what) with Python's words ("you moved s1", "agent1 drew s1"), snapshot(), restore()
  (the page's "reset" op). ui.ts reaches the history as host.api.uiHistory, not pi.events: each agent has its own
  bus, and session.reload() keeps the old listeners on it (nothing calls its clear()), so after a self-edit every
  change would be recorded twice.
  pi loads extensions in folder order (readdirSync, not sorted), so ui_history makes its History on session_start
  (all of that agent's extensions are loaded by then), not when its file loads.
  Bug found (also in the Python version): only "at" marker lines set the position on load, and a new step writes
  none; after a goto then a new step, a restart went back to the goto's step (and added a "start" step). Fix: a
  step line also sets the position. Also: the "changed while away?" check compares with sorted keys (a fresh
  record has "data" in the middle, a loaded one last; Python's dict == ignored order).
  Tested (page messages): move, set, undo x3 (the third does nothing), redo, a new change after undo (branch kept,
  "branched" sent), goto brings it back; an agent's ui_update and ui_render are steps under its name; a restart
  keeps the position, no extra step. Browser: Ctrl+Z removed the agent's card and showed "Back to just after: ...";
  Ctrl+Shift+Z brought it back. Not tested: pruning after 7 days.
- Alt-drag rewind, tested with real mouse events (CDP Input.dispatchMouseEvent with Alt): 2 bugs in ui_history.js
  (so in the Python version too), fixed in ../chalky-agent/plugins/ui_history.js (shared by both; not committed):
  1. a release outside the window was never seen, so plain mouse moves kept rewinding (back to step 0);
  2. the scrub only started once /ui-api/history came back: a quick Alt-click let go before that left it stuck
     the same way, and moves during the fetch were lost.
  Fix: the scrub starts at the press (follows the pointer once the history comes; cancelled if let go before);
  ends at release, at a move without the button held, pointercancel, or window blur. Retested all four cases.
  Fine before and after: an Alt-press on a card's title bar doesn't drag the card. Not seen: late "moved" replies
  replacing the "Gone back" message (possible on a slow link; only a wrong message).
  Note: the tests rewound the user's live page (it was at step 15 from their own use); put back after each test.
- Gotcha: host.shared keeps object instances across reloads, so a reload with a changed ui.ts keeps the old
  Surfaces methods (new ones need a server restart). Plain data in host.shared would not have this.
- Python ui_history.py: the same load fix (a step line also sets the position), in ../chalky-agent (not committed).
  Checked in agent-py:0.90 with the file mounted: on a file with a goto then a new step, the original ends at a
  bogus step 3, the fixed one at step 2.
- appdata.ts: GET/PUT /ui-api/app-data/<name> (JSON, 1 MB, letters/digits/_/-), state/app-data/<name>.json, event
  "app_data"; guide copied verbatim (paths swapped). Host change: a route ending in "/" also serves the paths one
  level under it (server.ts). Tested: missing app {}, save, read back, the event to an open page; bad name, encoded
  and plain ../, not JSON, over 1 MB, DELETE all refused. Agent built a groceries app (agents.load/save/on); in the
  browser, Add saved {"items":["milk","eggs"]}; the agent read the file, PUT with curl, the page showed flour.
  Decided (user): the last save wins, as in Python; add a version check (refuse saves made from an older value)
  if lost saves show up. Open: undo/rewind doesn't cover app data (should it?).
- Found: the ui-check skill's script (python, headless browser) fails here: it needs the agent-py image's Python
  libraries. Skills that run scripts need a Node (or no-install) version for the npm package.
- Python in skills/tools: only ui-check runs Python (check.py: aiohttp + /usr/local/bin/chrome-headless-shell, both
  only in the agent-py image). plugin-map describes the Python layout (kernel.py, plugins/*.py): wrong here, needs a
  rewrite. Old paths (/app/..., /workspace) in agent-apps, write-skill, ui-check: skills are copied as they were
  (the guides get their paths swapped, skills don't). Extensions and pi's tools: no Python.
- ui-check ported: scripts/check.mjs, Node only (Node 24's own WebSocket and fetch, no libraries). The browser:
  $CHROME, else chrome-headless-shell downloaded into ~/.cache/chalky-browsers ($CHALKY_BROWSERS), else an installed
  Chrome/Chromium/Edge (usual paths on Linux, Mac, Windows; a full browser gets --headless). None: exit 2 and it prints
  `npx --yes @puppeteer/browsers@3.2.4 install chrome-headless-shell@155.0.8059.84 --path <dir>` (pins: 3.2.4 from
  2026-10-08; Chrome 155's last build, 156 became Stable 2026-10-26). Decided (user): don't download now; the skill
  tells the agent to run that command only if no browser was found, and to report a failed download as it is.
  Tested: here (no browser) exit 2 with the command, nothing downloaded; in agent-py:0.90 (host node mounted), old
  and new against the live page: identical reports; on a test page with every step (click, type, key, dblclick,
  hold, drag, altdrag, dialog:accept=TEXT, eval, --fit): identical reports, byte-identical screenshots.
  check.py is still there (unused). SKILL.md: node scripts/check.mjs (pi: skill paths are relative to its folder),
  apps at /ui/apps/<name>/, read for screenshots. Not tested: an agent running it (it would download).
- Found by ui-check on the live page: GET /versions is 404 on every load (the versions plugin isn't ported).
- versions: researched pi first. Built-in extensions (mcp, llama.cpp, codemode, tool-search): none. ~15 community
  pi packages snapshot files with git (@ayulab/pi-rewind 32k/month GPL-3.0, pi-rewind, pi-rewind-hook,
  pi-workspace-history, pi-undo-redo, checkpoint-pi...): all are one developer undoing one conversation's changes
  in pi's terminal (/rewind, /undo, ctx.ui menus, tied to /tree), per session, most prune old checkpoints. Chalky
  needs a web panel, one shared history for all agents, code-only rollback, history kept forever, screenshots.
  Taken from pi-workspace-history: keep the git history outside the folder.
- versions.ts: history in state/versions.git (git --git-dir --work-tree=app), app/ has no .git (an agent's git
  can't rewrite it); first commit "original" (tag); info/exclude: auth.json, models-store.json (pi's login files,
  in app/ because agentDir = app/), node_modules/. Commit on pi's agent_settled (author = agent; message = reload
  reason (reload.ts now records it), else first thing said, else what was asked); "version" event, restart: false.
  Screenshot per commit with ui-check's check.mjs (no browser: none, logged once). Rollback without a process
  restart: stop all, commit uncommitted changes, git rm + checkout <sha>, new commit, host.reloadAgent() for
  every agent, ui.load() + a ui_history step if ui/surfaces.json changed, an fyi to each agent (swarm api.fyi:
  no turn). Host: reloadAgent() pulled out of prompt(); routes ending in "/" match any depth now.
  Tested: first commit 42 files (no auth/models-store/node_modules); agent1 edited the groceries app -> commit
  by agent1 + event; rollback to original (heading gone, 3 agents reloaded, fyi in each session, event);
  rollback of the rollback with an uncommitted card move (saved first as its own commit, then the card went back,
  page history step added); bad ids 400/404; the Versions panel lists them (no previews), Roll back disabled on
  the current one; viewport saved.
  Notes: commit messages are often just "done" (the first thing said, as in Python). Rolling back code also moves
  cards back (surfaces.json is versioned, as in Python). A rollback of ui.ts / ui_history.ts code doesn't replace
  the objects kept in host.shared (old methods until a server restart). Git must be installed (npm package:
  maybe isomorphic-git).
- versions, follow-ups: commit message = reload reason, else what the agent was asked (not "done"), else what it said.
  Git through isomorphic-git 1.44.2 (pinned; 2026-10-12; ~1.5M downloads/week; MIT; audit: nothing new): no git
  program needed. One history operation at a time (a queue in host.shared); first commit made once, through the
  queue (no top-level await: pi loads extensions with jiti). Rollback: checkout(ref, noUpdateHead, force) puts
  that commit's files in app/ and the index (deletes the ones it lacks), then a commit.
  Bug in isomorphic-git 1.44.2 (doc/reality): statusMatrix checks ignores without the gitdir, so with a gitdir
  outside dir it misses <gitdir>/info/exclude and reports auth.json, models-store.json and ui/node_modules as new;
  isIgnored({gitdir}) is right. My mistakes on top: counted them as changed (add() skipped them: empty commits), the
  stray guard warned about them and that warning started a turn: a loop, ~70 model calls, stopped by stopping the
  server. Fixes: filter new files with isIgnored; commit with disallowEmpty; warn only about stray files that
  exist. The looped history is kept aside in state/versions.git.loop; a fresh one was made.
  Tested with a fake git first on PATH (logs any call): never called. Fresh history: "original" 42 files, branch
  main. Agent change: one commit, message = the request. A real stray file (app/notes.txt): one warning, one reply,
  no more commits. Rollback to original (notes.txt deleted, heading back), an unsaved file kept as its own commit,
  rollback of the rollback; real git status agrees the folder matches. Test files removed by a rollback (recorded).
- Loop bug retest: only ignored things changed (a file in ui/node_modules, one in ui/apps/groceries/node_modules,
  auth.json and models-store.json touched). statusMatrix alone still reports 47 "new" files (the isomorphic-git bug);
  after our isIgnored filter: none. A turn with no code change: no commit. A turn changing one file: one commit
  with only that file. No new system notes, no commits afterwards.
- Browser downloaded (user's call): `npx --yes @puppeteer/browsers@3.2.4 install chrome-headless-shell@155.0.8059.84
  --path ~/.cache/chalky-browsers` -> 271 MB on disk (my "about 150 MB" was low), all its Linux libraries present here.
  ui-check now runs on this machine (2 s, found it with no settings). versions: the next version got its screenshot
  (state/shots/<sha>.png, 175 KB) and the Versions panel shows it; apps (iframes) are in the picture. Versions made
  before the download have none.
- tests/versions-ignore.mjs: plants ignored files (ui/node_modules, an app's node_modules, touches auth.json),
  runs one tool-free agent turn, checks no commit and no "aren't your code" warning, cleans up; says whether
  isomorphic-git still has the statusMatrix bug (it does). Refuses to run (exit 2) if app/ has real uncommitted
  changes. First run found exactly that: my own ui-check edits were committed under agent1's name (any change in
  app/ goes to the next agent turn's commit, as in Python).
- Skills cleaned: agent-apps and write-skill say "your code folder (the one your prompt names)" instead of /app
  (skills are copied as is; the guides get paths filled in); write-skill: no skill() tool in pi (it lists name,
  description and path; read SKILL.md), a new skill shows after a reload, scripts in node or bash. plugin-map
  rewritten for extensions/*.ts (map = each file's first comment line), guides, skills, ui, the host (read only).
  check.py deleted (in the version history). Left: extensions/hello.ts (the spike's self-edit test tool, no header).
- Screenshot experiment blocked: loading dom-to-image-more / modern-screenshot from a CDN into the live page was
  refused by the safety check (outside code in the page connected to the agents). Not worked around.
- Screenshot test A (a copy of a Chalky-like page served from the scratchpad on :3100, not the live page;
  dom-to-image-more 3.11.0 installed in the scratchpad, --ignore-scripts, 29 KB, no dependencies): the page alone
  draws everything (glass blur, canvas, image, table) except the app iframe, which comes out blank. Its README's
  "same origin iframes" means a node inside one, not iframes it meets. Drawing each same-site iframe's own
  document and pasting it in place: matches the real screenshot (scrollbar aside), 84 ms in the page.
- plugin-map vs pi: pi lists tools and skills in the prompt and points at its own docs (only for questions about
  pi), but never says which extensions are loaded or what they do. Context files: pi loads AGENTS.md from the
  agentDir (= app/) and from the working folder and its parents; off here (noContextFiles), since the parents
  hold this sandbox's own CLAUDE.md. Community packages (pi-fovea, layermap, pi-read-map, codebase indexes, LSP
  tools) are general code maps (tree-sitter, embeddings): plugin-map stays (Chalky's layout and header rule).
- Screenshots now taken by the open page (user's call, no headless fallback): page/versions-shot.js (new folder
  page/: browser files of the pi version, not the agents', outside app/), dom-to-image-more 3.11.0 (exact, in
  package.json). After a "version" event (2 s later) and, on opening, for the current version if /versions says
  shot: false. Draws #top up to the last surface, pastes each same-site app frame's own page, crops to the
  surfaces + 32 px, PUT /versions/<sha>/shot (PNG, 10 MB, first page wins: {saved: false}, not 409, so browsers
  don't log an error). versions.ts no longer runs a browser; the downloaded browser is only for ui-check.
  Tested: a version made with no page open had no picture, a page opening took it (54 KB; app included); a page
  kept open while agent1 changed the heading: the new version's picture shows it; bad PNG, over 10 MB, unknown
  version, bad id refused; a second upload not saved. Left: the panel asks for a new version's picture at once,
  before the page uploads it (one 404, then its own retry shows it): unchanged page, same in Python.
  Background is the body's plain colour (the page's gradient isn't drawn). extensions/hello.ts removed (user).

## Its own repo (2026-10-27)
- The folder was renamed from `chalky-agent-test` to `pi-chalky`, and `package.json`'s name with it. Git, branch
  main; GitHub: weihanfeng/pi-chalky (private, like chalky-agent). First commit 77c0eef: 48 files.
- Committed: server.ts, package files, NOTES.md, page/, tests/, and app/'s starting code (extensions, skills,
  ui components, agents.js, voice.js, ui package files, apps/.keep).
- Kept out (`.gitignore`): pi's logins (app/auth.json, app/models-store.json), state/ and state-run*/ (runtime),
  workspace/ (test drops), node_modules/, and what agents build (app/ui/surfaces.json, app/ui/apps/*), as the
  Python repo does. A missing surfaces.json is read as no surfaces, so a fresh install starts empty.
- Two histories now, for different things: this repo (our code, by us) and state/versions.git (app/ as the agents
  change it). They don't see each other: state/ is ignored here, and versions.git has its own work tree, app/.
- The rename started fresh conversations: pi only continues a session saved from the same cwd (its
  `findMostRecentSession` matches the session header's cwd). The old ones are still in state/sessions/.

## One folder per extension (2026-10-27)
- Why: the browser files were split between a `page/` folder and the Python repo (`../chalky-agent/plugins/`, read
  at run time): pi-chalky didn't work cloned alone, couldn't be packaged, and Python edits changed it unnoticed.
  The user: agents should be able to edit everything, the page too, and everything should be an extension.
- pi (docs/extensions.md, core/extensions/loader.js): loads `extensions/*.ts|*.js` AND `extensions/<dir>/index.ts`
  (or a package.json "pi" manifest), nothing else in a folder. So loose browser files in `extensions/` would be
  loaded as (broken) extensions: one folder per extension avoids that. `resources_discover` returns skill folders
  (agent-session.js runs it on startup and on reload); this is pi's package layout too (docs/packages.md).
- Done: every extension is `extensions/<name>/` (`git mv`, history kept); browser halves copied from
  ../chalky-agent/plugins (working tree, with the uncommitted ui_history.js fix) as `<name>/browser.js`;
  `chat_ui.html` is `page/page.html`; the ui components, agents.js, voice.js, the browser libraries
  (package.json, node_modules) and the ui skills (ui-check, ui-design, agent-apps) are in `extensions/ui/`.
- New `page` extension: `GET /`, `GET /page/scripts` (every `extensions/*/browser.js` found, like pi finds
  index.ts: an extension registers nothing), `GET /extensions/<name>/browser.js` (only that file). `host.scripts`
  is gone. The page reloads after a version that changes page.html or a browser.js.
- `ui` now serves `/ui/` (apps from app/ui/apps; components/, agents.js, voice.js, node_modules/ from its folder;
  anything else 404, `..` refused) and `/ui-api/catalog`, `/ui-api/about`; the catalog moved out of server.ts.
  Host offers `host.file(res, path)`. URLs the page and apps use are unchanged.
- Texts: the prompt intro (one folder per extension; the page is the page extension), ui guide paths,
  plugin-map (map = `extensions/*/` headers), write-skill (a feature's skills go in its extension), headers.
- Version history: the old one moved to `state/versions.git.before-folders` (kept): every old version needs
  `host.scripts`, so rolling back to one would break the agents and the page. A new history started ("original"
  = the new layout).
- Two fixes from earlier that NOTES described but the code didn't have: `/versions` entries' `shot` field, and
  `{saved: false}` (200) instead of 409 for a second picture. Both in now.
- Tested: every route (page, 6 browser parts, /ui/ files and 404s, catalog, history, versions, files, viewer
  previews of docx/pptx/xlsx/pdf); headless page: 5 surfaces drawn, palette, files panel, app frame, no error
  notes; agent1 lists all 5 skills (3 from the ui extension), also after its reload tool; an agent edit made a
  version with the request as message and the open page took its picture; rollback restored the file, new
  commit by user; undo/redo; upload; tests/versions-ignore.mjs passes (isomorphic-git still has the bug).
- Not done: pi-message -> page translation still in server.ts (belongs to the page extension; a later step).
  The broken-page risk (an agent breaks the page, so the Versions panel too): later, with start.sh recovery.

## Frames (2026-10-27)
- What: the user drags boxes on the main space, writes in each what goes there, presses Implement; all go to one
  agent as one message; a frame is done (its dashed box goes) when a surface with its id appears.
- `extensions/frames/`: index.ts (port of frames.py: GET /frames, page messages frame_add/place/text/remove,
  frames_send, event "frames", state/frames.json), browser.js (frames.js unchanged but its header), guide.md.
  The page found browser.js by itself: nothing registered.
- New general hook, the pi side of Python's "ui_changed": `host.api.ui.watch(name, fn(surface, by, what))` in the
  ui extension. Watchers are kept on the host by name (a reload replaces its own; a throwing one is reported, the
  rest still run); registered from session_start (pi's load order). ui_history now uses it too (was a direct call).
- Guide changes (Python's text otherwise): no task board yet (tasks not ported), so helpers get their frame by
  tell; "the page's own code" = page.html and the browser.js files; ui-check finds its own browser.
- Bug from the restructure, found here: `host.catalog()` -> `catalog()` made `const catalog = catalog()` (use
  before init): every ui tool failed. The function is `readCatalog()` now. The restructure tests didn't call a
  ui tool; this one did.
- Tested: add/text/move/remove through page messages; Implement -> agent1 rendered frame-3 at the frame's place
  -> frame gone, history step "agent1 drew frame-3"; headless page: Frames and Implement in the palette, the tool
  turns on, the counter drawn. Test counter closed afterwards.
- Seen: editing app/ while the server runs puts those edits in the agents' version history under the next
  agent's turn (its message). Harmless; stop the server, or expect it.

## Full test round (2026-10-27)
Static: `node --check` on every file; a scan for names shadowing themselves (the catalog bug); every host member
and host.api service used is defined; every URL the browser code calls has a route (except /voice-api/*: voice
not ported; voice.js then falls back to the browser's speech recognition).
Live (server, page messages, the agent, and the real page in headless Chrome with mouse/keyboard/drag input):
- ui: a surface with a bound TextField and a Button; typing reached the data, the click reached the agent
  ("hello Bob"); move, pin (a pinned surface refuses moves), prop (id refused), close.
- ui_history: undo, redo, goto (field `step`), unknown steps ignored, no step for changes that change nothing.
- point: Point tool + click on a button + note -> agent got surface/component/position, called note_done.
- files: a real drag of a file from disk -> uploaded to drops, note box "Use qa-drop.csv here" -> the agent
  read it with read_document. Viewer: report.docx from the panel (headings, list, merged-cell table); /viewer/shot.
- appdata: load/save from inside the groceries app frame (agents.js), bad JSON and `..` names refused.
- swarm: ask_agent (agent2 answered 42), tell (answer comes back to the sender), app bridge (agents.send from an
  app -> agent2), Stop (bash `sleep 60` killed, agents idle).
- self-edit: agent1 wrote extensions/qa_hello/index.ts (it read plugin-map first), reloaded, used the tool;
  version message = its reload reason. Rollback -> the tool was gone.
- versions: stray-file warning (agent moved the file to the workspace itself); Versions panel (list, picture,
  rollback disabled for the current); restart keeps surfaces, data, history position, versions.
- ui-check: check.mjs found the downloaded browser, screenshot, reported layout problems.
Bugs found and fixed:
1. point told agents `/app/ui/components/X.js` (the Python container's path; after the restructure also the
   wrong folder) and `/app/plugins/chat_ui.html`. Now browser.js names extensions/ui/components and
   extensions/page/page.html, and index.ts swaps /app/ for the real code folder.
2. Stop showed "agent1 error: This operation was aborted": pi 1.4.0 recorded the stop (during a bash tool) as
   stopReason "error", not "aborted" (its type has "aborted"; openai-completions only sets it if the model call
   itself is aborted). New `host.abort(name)` marks the run as stopped on purpose; the swarm's stop and the
   step limit use it; prompt() then returns "(stopped)" and shows no error.
3. A rollback left folders it emptied (isomorphic-git removes files, not folders): an extension folder without
   index.ts stayed (in the map, in `ls extensions`). Now emptied folders are removed after the checkout.
Seen, not changed:
- The page still sends {type: "viewport"}; nothing reads it now (it was for headless screenshots).
- A turn started by a system message (the stray-file warning) gets that warning as its version message.
- Not re-run this round (code unchanged since they were tested): spawn_agent, reset/app_reset, point_combine
  (drag a surface onto another), Alt-drag history scrub, the frames eraser (doodle not ported).

## Recovery, the safety net (2026-10-27)
- Python's start.sh restarted the agent and, if a start crashed within 20 s, went back to git tag "last-good".
  Not needed here: pi skips an extension that fails to load (and reports it), and the host catches the errors
  nothing handled, so the server keeps running.
- What was missing: an agent breaks the page (the page extension, page.html, a browser.js) or the versions
  extension, and the user loses the Versions panel, the only way back.
- Fix, in server.ts (the fixed core, so agents can't break it too): `GET /recover`, plain HTML forms, no script.
  It lists the versions (state/versions.git); "the page worked" = the page took its picture of that version; every
  row has "go back to this", the newest too (a broken versions extension doesn't save the edit that broke it).
  `POST /recover/<sha>`: stop the agents, save the current files ("uncommitted changes before recovery"), put that
  version's files back, commit "recover to ...", reload every agent, then a 303 redirect back to the page. It lists
  what failed to load (agent1's extension errors).
- When it shows: at `/` by itself when no extension serves the page (the page extension failed); otherwise the user
  goes to /recover (the server prints it at start). A page that loads but has a script error can't be detected by
  the server (only the browser sees it), so no automatic rollback: the user sees a broken page better than the
  server does.
- The rollback steps are now in two places (versions extension and server.ts, ~30 lines): accepted for a safety net.
- Tested: a syntax error in page/index.ts + restart: `/` showed the recovery page with the error; going back fixed
  the file and the page came back without a restart (the reload loads the page extension again). A broken
  versions extension: /versions 404, /recover still listed versions, going back fixed it. A syntax error in
  page.html's script, in headless Chrome: the page blank; /recover, a real click on the button, back on a working
  page (surfaces, palette, panels).
- Note: a broken extension's old routes stay after a reload (host.routes isn't cleared), so the page breaks only
  at the next start. Then /recover.

## Doodle and screen (2026-10-27)
- doodle: the Python doodle plugin as an extension (index.ts, guide.md, browser.js = doodle.js unchanged but its
  header). Three tools in the palette: marker (drag draws, typing writes, a click after drawing makes a step:
  a picture cropped to the drawing), Text (click, type, Enter), eraser (lines, words, and unsent frames through
  the "erase" page event). Enter in the message line sends doodle_send; the server writes it as words and the
  steps' pictures go with it.
- screen: the Python screen plugin as an extension. The page shares its tab once (getDisplayMedia) and uploads
  crops (POST /screen/shot, png, at most 8 MB, saved in state/screens); agents get see_user_screen (the page shows
  "agentN wants to see your screen · Share / No" if the tab isn't shared yet; 90 s, or Stop). host.api.screen.isShot
  (path): only pictures saved there can be attached (a doodle_send naming /etc/passwd attaches nothing).
- Pictures with a message: pi's prompt(text, {images}) and steer(text, images) take {type: "image", data, mimeType}.
  host.prompt got an images argument; swarm items carry png paths, read when the agent gets the item.
- Tested: palette shows the three tools; a line drawn and a click made "1 mark"; Enter sent it (words only, the tab
  not shared) and agent1 read the step; a doodle_send with a real png (sent over /ws): the model answered "A pink
  circle"; see_user_screen answered by a stand-in page: picture and the main-space offset reached the model; the
  page's card, "No" clicked: the agent was told and the card went; Text wrote "make bigger"; the eraser removed
  it and an unsent frame (the frames eraser, untested before).
- Not testable here: sharing the tab. Headless Chrome (chrome-headless-shell 155, and Playwright's full Chromium
  with --headless=new) fails getDisplayMedia with "NotReadableError: Could not start video source", also with
  --auto-accept-this-tab-capture. So the picture from a real share needs a real browser.
- Seen: state/screens grows (as in Python; nothing removes old pictures). My new extension folders were committed
  in the versions history under agent1's next turn (the known attribution effect), and that version reloaded the
  open page (a new browser.js), which cleared the doodle steps in progress.
- The user's meme-maker app logs "Uncaught SyntaxError: Identifier 'top' has already been declared" (its own
  index.html, made by an agent). Not touched.

## Clean-ups (2026-10-27)
- Thinking: pi's "off" for an openai-completions model means pi sends no reasoning_effort, so the model uses its
  own default, and it does think (up to 152 reasoning tokens per answer in agent1's record). As the Python agent
  did. New optional MODEL_THINKING (minimal, low, medium, high, ...): server.ts calls setThinkingLevel; pi then
  sends reasoning_effort. Tested with low: the session saved thinkingLevel "low" and the answer came (391).
- ui-check: check.mjs exits 1 only for failed steps and errors; layout problems are printed but don't count (an
  exit code 1 shows as a failed command in pi, and the agent's meme app turn looked red for a meant overhang).
  SKILL.md says to judge each. Tested: the meme app (layout only) exits 0; a page that throws exits 1.
- The pi-message -> page conversion moved from server.ts to the page extension, so agents can change it too.
  server.ts now hands every agent's pi event to host.eventHandlers (it still subscribes itself: pi doesn't pass a
  custom message filed while idle, e.g. a swarm fyi, to extensions' pi.on, only to session.subscribe), and calls
  host.connectHandlers when a page opens. "joined" and reply_to are read from the session (pi saves a message
  after its message_end; a prompt update can sit between the "chalky.turn" entry and the user message), so the
  host's Agent lost `joined` and `replyTo`. Tested: a page opening got 596 messages; a live message came with
  reply_to; run_start/run_end; idle fyis (from a recovery) shown; one "joined" per session file; the page in
  Chrome shows the conversation.
- pi's preamble ("You are an expert coding assistant operating inside pi..."): replaced the pi way, with
  app/SYSTEM.md (docs/configuration.md: "<agent-dir>/SYSTEM.md replaces Pi's default system prompt"; agentDir is
  app/). It replaces pi's preamble and its tools, rules and docs sections (inside pi it becomes customPrompt).
  Kept in our words: who the agent is, and the tool rules worth having (read/bash/edit/write; the no-op edit).
  tools dropped (the model gets every tool's description anyway). docs: a plain file can't hold paths, so the
  prompt extension's intro points at pi's docs with pi's own getDocsPath/getExamplesPath/getReadmePath.
  SYSTEM.md counts as code for the versions extension (no stray-file warning).
- Then the words moved too: app/SYSTEM.md holds everything the agent is told about itself (who it is, how it
  works with the user, its tools, how to change itself) and names the sections after it (<cwd>, <paths>); the
  prompt extension only adds <paths> (code folder, host, pi's docs), the values a plain file can't hold. Before,
  two "You are..." intros and the main one buried among the extension sections (pi adds them in load order).
  The prompt now: SYSTEM.md, pi's skills and cwd, the extension sections, <paths>. Asked where its code and its
  project work go, agent1 named app/ and workspace/.
- Project trust: SettingsManager.inMemory() trusts the project (cwd = workspace/) by default, so a
  workspace/.pi/SYSTEM.md (or .pi/extensions, skills, settings) would have been used, unversioned. Now
  inMemory({}, {projectTrusted: false}). Tested: a planted workspace/.pi/SYSTEM.md ("answer only BANANA") was
  ignored; agent1's sections: preamble (SYSTEM.md), skills, cwd, then ours; asked who it is and where pi's
  extension docs are, it answered with the real path.

## Doc/reality mismatches (pi 1.4.0)
- A Stop during a tool call is saved as stopReason "error" ("This operation was aborted"), though StopReason has
  "aborted". Handled in the host (host.abort).
- `examples/extensions/reload-runtime.ts`: `pi.sendUserMessage("/reload-runtime", {deliverAs: "followUp"})` reaches
  the model as text (`expandPromptTemplates` defaults to false), so the command never runs. With our reload tool the
  model called it again on each "/reload": 55 rounds (~110 model calls) before the server was stopped.
  Fix here: the tool marks the agent; the host calls `session.reload()` after the turn.
- `DefaultResourceLoader({ additionalExtensionPaths: [<folder>] })` fails ("Cannot find module <folder>"); the folder
  scan in extensions/loader.js isn't used for these paths. Fix here: agentDir = app/ (pi's own `extensions/` folder).

## Open questions / gaps
- "agent joined" shows one line late: pi saves the system message after the first user message.
- Shared state between agents goes through `globalThis.chalky` (a convention of ours; pi extensions are per session).
- Not ported yet:
  voice, tasks, mcp (pi has MCP). (vision: covered by pi's read.)
- `npm audit`: 1 high + 1 moderate, both undici 8.10.2 inside pi 1.4.0 (EventSource memory DoS, SRI bypass,
  content-encoding DoS). npm's only "fix" is downgrading pi to 0.75.3, so not applied; wait for a pi release.
  The viewer libraries add none.
