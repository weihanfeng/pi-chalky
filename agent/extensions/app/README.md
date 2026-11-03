# Making an app (the app extension)
Everything a usual app needs is here: for one, you don't need the card README or the design and browser-check skills.

## Write it, show it
- Write {built}/apps/<name>/index.html (other files next to it), then card_show(card=<id>, app=<name>, about="...").
  It is served at {page}/built/apps/<name>/. card_show checks it on the board and reports errors and whether it
  fits its card: fix those and show it again. height=<px>: its height when nothing else sizes it (default 400).
- about: one or two sentences on what it is for and any decision a later change should respect (its back side).
- Name what the user may point at: ids or data-name on elements ("habit-Read", not "row3"). A canvas: give the
  page's window a partAt(x, y) returning {"name", ...} for what is at that spot.
- The user moves and resizes the card: fill the space (%, flex, grid, an SVG with a viewBox), not fixed px.
- A pinned card (the user held its label): card_show on it fails. Make a new card (made_from=[it]) or ask.
- Changing it later: edit the part (the edit tool), not a rewrite. App files show when your turn ends.

## Keep its data
`import agents from "/app/agents.js"` (a module script). `await agents.load()` gives the saved data ({} at first);
`agents.save(data)` replaces it after every change (on the server, {data}/app/<name>.json: kept across reloads, the
same in every browser, readable by you with cat). Other cards showing the same app hear each save:
`agents.on("app_data", ({app, data}) => { if (app === agents.app) ... })` (the field is `data`). Never localStorage
(one browser only, invisible to you). To change it yourself: curl -X PUT --data @new.json {page}/app/data/<name>.

## An app that asks an AI (a plan from a goal, a summary, an answer)
A real agent does it, never a canned sample. While building, spawn one for the card: team_spawn(role, name="planner",
app=<card id>), its role ending "Answer only with JSON like {...}. Don't use tools." In the app:
```
const asked = Date.now() / 1000; agents.send("planner", goal);
agents.on("message", (ev) => {  // events replay on connect: take only the answer to this question
  if (ev.agent !== "planner" || ev.role !== "assistant" || ev.tool_calls?.length || ev.ts < asked) return;
  data.plan = JSON.parse(ev.text.slice(ev.text.indexOf("{"), ev.text.lastIndexOf("}") + 1)); agents.save(data); draw();
});
```
Show that it is thinking while it waits; agents.send is limited per minute. Agents with personalities that talk to
each other (a debate, a simulation): load the app-agents skill.

## Apps that work together
Each card is its own page: a click in one never reaches another. One app saves what was picked
(`agents.save({...data, picked: "Goblet squat"})`); the other hears every app's saves:
`agents.on("app_data", ({app, data}) => { if (app === "fitflow") show(data.picked) })`, and can read the first one's
data at start with `fetch("/app/data/fitflow").then((r) => r.json())`.

## Look
The page is light, glassy and quiet; match it unless the user asks for another look:
- Transparent background; the system font (`font: inherit` or system-ui); text #1d1d1f, muted rgba(60,60,67,.55),
  accent #0071e3, danger #e5484d, lines rgba(0,0,0,.06), glass rgba(255,255,255,.7), radius 16px.
- Show just the thing: no frame or panel around it unless it needs one. Group with flex/grid and gap.
- Open in a working state (its real data, or a marked example), never an empty shell; `tabular-nums` for digits.
- Buttons say what happens ("Add habit"); short plain words; status colours always with a word or icon.
- Avoid the generic AI look: cream and terracotta, purple gradients, emoji as markers, the same shadowed card on
  everything. For a chart, a diagram, a game's art or a restyle, load the design skill.

## Check it works
card_show covers errors and fit. Before telling the user what it does, try its main action and a reload with
{agent}/skills/browser-check/scripts/check.mjs:
```
node <that check.mjs> {page}/built/apps/<name>/index.html "eval:(()=>{const i=document.querySelector('#new'); i.value='Test-1';
  i.dispatchEvent(new Event('input',{bubbles:true})); i.form.requestSubmit(); return 'ok'})()" wait:800 \
  "eval:document.body.innerText.includes('Test-1')"
```
Set values with eval (`type:` adds to what a field already holds). Run it again to see what a reload keeps.
Your test writes the user's real data: note it first (cat {data}/app/<name>.json) and put it back afterwards
(PUT, above). Say only what you saw working.

## More
- Calculations (totals, streaks, dates) belong in the page's code, never worked out by you and typed in.
- Voice input: import /voice/voice.js (read its header), not the browser's speech API.
- Libraries: put an ES-module build in {agent}/extensions/card/lib/<pkg>/ and import /card/lib/<pkg>/<file>.js.
- agents.action(name, context) wakes the agent that owns the card (for what truly needs you); the rest of the
  bridge: the header of {agent}/extensions/app/agents.js.
