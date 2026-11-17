// End to end: a fresh home with known cards and an app, its own server, then every feature through HTTP, the
// WebSocket (as the page talks), headless Chrome (the browser-check skill's script) and real agent turns.
//   node tests/e2e.mjs [--no-model] [--keep]   (PORT: default 3300; the model and MCP settings come from the environment)
// The home is a new folder in the system's temp folder, removed at the end unless --keep. Prints ok/FAIL per check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";

const ROOT = path.resolve(import.meta.dirname, ".."), PORT = Number(process.env.PORT || 3300), URL = `http://127.0.0.1:${PORT}`;
const MODEL = !process.argv.includes("--no-model"), KEEP = process.argv.includes("--keep");
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "chalky-e2e-"));
const CHECK = path.join(ROOT, "agent/skills/browser-check/scripts/check.mjs");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let failed = 0, passed = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || !detail ? "" : `: ${detail}`}`); ok ? passed++ : failed++; };
const section = (name) => console.log(`\n== ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { const r = await fetch(URL + p); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const req = async (method, p, body) => { const r = await fetch(URL + p, { method, body }); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const cards = async () => (await get("/card/all")).body;

// ---- the seed: cards of every kind, an app, two boards ----
const blocksCard = (blocks, rest = {}) => ({ owner: "agent1", blocks, place: null, draggable: true, resizable: true, about: "", board: 1, ...rest });
fs.mkdirSync(path.join(HOME, "built/apps/counter"), { recursive: true });
fs.mkdirSync(path.join(HOME, "data"), { recursive: true });
fs.writeFileSync(path.join(HOME, "built/apps/counter/index.html"), `<!doctype html><body><b id=n>?</b><button id=b>+1</button>
<script type=module>import agents from "/app/agents.js"; let d = await agents.load(); const show = () => n.textContent = d.count ?? 0; show();
b.onclick = async () => { d = { count: (d.count ?? 0) + 1 }; await agents.save(d); show(); };</script>`);
fs.writeFileSync(path.join(HOME, "built/card.json"), JSON.stringify({
  form: blocksCard([
    { id: "root", block: "Column", children: ["name", "echo", "tabs", "tA", "tB"] },
    { id: "name", block: "TextField", label: "Name", value: { path: "/name" } },
    { id: "echo", block: "Text", text: { path: "/name" } },
    { id: "tabs", block: "Row", children: ["bA", "bB"] },
    { id: "bA", block: "Button", label: "A", set: { "/tab": "a" } }, { id: "bB", block: "Button", label: "B", set: { "/tab": "b" } },
    { id: "tA", block: "Text", text: "tab A", when: { path: "/tab", is: "a" } }, { id: "tB", block: "Text", text: "tab B", when: { path: "/tab", is: "b" } },
  ], { place: { x: 560, y: 40 }, about: "a form to test bindings" }),
  src: blocksCard([{ id: "root", block: "Text", text: { path: "/n" } }], { place: { x: 900, y: 40 } }),
  reader: blocksCard([{ id: "root", block: "Panel", title: "Reader", child: "v" }, { id: "v", block: "Text", text: { ref: "src", path: "/n" } }], { place: { x: 900, y: 160 } }),
  pick: blocksCard([{ id: "root", block: "Text", text: "option A" }], { place: { x: 560, y: 420 },
    options: [{ label: "A", blocks: [{ id: "root", block: "Text", text: "option A" }], data: {} }, { label: "B", blocks: [{ id: "root", block: "Text", text: "option B" }], data: {} }] }),
  app1: { owner: "agent1", app: "apps/counter/index.html", height: 120, place: { x: 900, y: 420 }, board: 1, about: "" },
  far: blocksCard([{ id: "root", block: "Text", text: "on board 2" }], { board: 2 }),
}));
fs.writeFileSync(path.join(HOME, "data/card.json"), JSON.stringify({ form: { name: "", tab: "a" }, src: { n: 5 }, reader: {}, pick: {}, app1: {}, far: {} }));
fs.writeFileSync(path.join(HOME, "built/board.json"), JSON.stringify({ last: 2, boards: [1, 2] }));

// ---- the server, and a WebSocket like the page's ----
const server = spawn(process.execPath, [path.join(ROOT, "server.ts")], { env: { ...process.env, CHALKY_HOME: HOME, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
server.on("exit", (code, signal) => (log += `\n[server exited: code ${code}, signal ${signal}]`));
for (let i = 0; i < 60 && !log.includes("chalky (pi) on"); i++) await sleep(500);
const events = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.on("message", (raw) => events.push(JSON.parse(raw)));
await new Promise((r) => ws.on("open", r));
const send = (m) => ws.send(JSON.stringify(m));
async function waitFor(pred, ms = 10000, from = 0) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const e = events.slice(from).find(pred); if (e) return e; }
  return null;
}
async function turn(msg, ms = 400000) {  // a message that wakes an agent: its events until every agent is idle again
  const mark = events.length;
  send(msg);
  const start = await waitFor((e) => e.type === "run_start", 60000, mark);
  if (!start) return { events: events.slice(mark), calls: [], timedOut: true };
  const i = events.indexOf(start);
  const idle = await waitFor((e) => e.type === "status" && Object.values(e.agents).every((a) => a.state === "idle"), ms, i);
  const out = events.slice(mark);
  const calls = out.filter((e) => e.type === "message").flatMap((e) => (e.tool_calls ?? []).map((c) => ({ agent: e.agent, name: c.function.name, args: c.function.arguments })));
  return { events: out, calls, timedOut: !idle };
}
const browser = async (steps) => {  // the browser-check script: [evals in order], errors (async: a blocked test loses its sockets)
  let out = "";
  try { out = (await promisify(execFile)(process.execPath, [CHECK, `${URL}/`, "wait:2500", "eval:document.body.dataset.panel=''", ...steps], { encoding: "utf8", timeout: 120000 })).stdout; }
  catch (e) { out = (e.stdout ?? "") + (e.stderr ?? ""); }
  const evals = [...out.matchAll(/^eval .* -> (.*)$/gm)].map((m) => { try { return JSON.parse(m[1]); } catch { return m[1]; } }).slice(1);  // not the panel's
  const errors = Number(/errors \((\d+)\)/.exec(out)?.[1] ?? -1);
  return { evals, errors, out };
};

try {
  section("start");
  check(log.includes("chalky (pi) on"), "server started", log.slice(-300));
  check(["agent", "built", "data", "workspace"].every((d) => fs.existsSync(path.join(HOME, d))), "the four folders");
  check(!fs.existsSync(path.join(HOME, "agent/ui")) && !fs.existsSync(path.join(HOME, "agent/auth.json.copy")), "agent/ holds only agent parts");
  const scripts = (await get("/page/scripts")).body;
  check(Array.isArray(scripts) && scripts.length === 14, "every extension's browser part is listed", JSON.stringify(scripts));
  check(!/extension .* failed|uncaught/.test(log), "no extension failed to load", log.slice(-400));
  check((await get("/recover")).status === 200, "/recover answers");

  section("the page in a browser");
  const b1 = await browser([
    "eval:[...document.querySelectorAll('.board.on [data-card]')].map(c=>c.dataset.card).sort().join(',')",
    "eval:document.querySelector('[data-card=reader]').innerText.includes('5')",
    "eval:[document.querySelector('[data-card=form] [data-block=tA]').hidden, document.querySelector('[data-card=form] [data-block=tB]').hidden]",
    "click:[data-card=form] [data-block=bB] button", "wait:800",
    "eval:[document.querySelector('[data-card=form] [data-block=tA]').hidden, document.querySelector('[data-card=form] [data-block=tB]').hidden]",
    "type:block-textfield input=Ada", "wait:1500",
    "eval:document.querySelector('[data-card=form] [data-block=echo]').innerText",
    "eval:document.querySelector('[data-card=pick] .card-options')?.innerText.replace(/\\s+/g,' ')",
    "eval:document.querySelector('[data-card=app1] iframe').contentDocument.getElementById('n').textContent",
    "eval:document.querySelector('[data-card=app1] iframe').contentDocument.getElementById('b').click()", "wait:800",
    "eval:document.querySelector('[data-card=app1] iframe').contentDocument.getElementById('n').textContent",
    "eval:document.querySelector('[data-card=src] .card-label').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))", "wait:600",
    "eval:!!document.querySelector('[data-card=src] .card-back')",
    "eval:document.querySelectorAll('#log .group').length >= 0",
  ]);
  const [shown, refOk, tabs1, tabs2, echo, optBar, n0, , n1, , back] = b1.evals;
  check(b1.errors === 0, "page loads with no errors", b1.out.slice(-500));
  check(shown === "app1,form,pick,reader,src", "board 1's cards are drawn (board 2's hidden)", shown);
  check(refOk === true, "a {ref} prop reads another card's data");
  check(JSON.stringify(tabs1) === "[false,true]" && JSON.stringify(tabs2) === "[true,false]", "Button set + when: tabs switch", `${JSON.stringify(tabs1)} ${JSON.stringify(tabs2)}`);
  check(echo === "Ada", "typing into a bound field updates a bound Text", echo);
  check(/1 of 2: A/.test(optBar ?? ""), "options bar", optBar);
  check(n0 === "0" && n1 === "1", "an app card runs, and saves through /app/agents.js", `${n0} -> ${n1}`);
  check(back === true, "double-click turns a card over (its back side)");
  const c1 = await cards();
  check(c1.form.data.name === "Ada" && c1.form.data.tab === "b", "the page's typing and clicks are saved (card_set)", JSON.stringify(c1.form.data));
  check((await get("/app/data/counter")).body.count === 1, "the app's data is on the server");

  section("cards: page messages");
  send({ type: "card_prop", card: "src", block: "root", prop: "variant", value: "h2" }); await sleep(400);
  check((await cards()).src.blocks[0].variant === "h2", "card_prop changes a block's prop");
  send({ type: "card_prop", card: "src", block: "root", prop: "block", value: "Table" }); await sleep(400);
  check((await cards()).src.blocks[0].block === "Text", "card_prop can't change the structure");
  send({ type: "card_move", card: "src", place: { x: 910, y: 50 } }); await sleep(400);
  check((await cards()).src.place.x === 910, "card_move");
  send({ type: "card_pin", card: "src", pinned: true }); await sleep(300);
  send({ type: "card_move", card: "src", place: { x: 1, y: 1 } }); await sleep(400);
  check((await cards()).src.pinned === true && (await cards()).src.place.x === 910, "a pinned card doesn't move");
  send({ type: "card_pin", card: "src", pinned: false }); await sleep(300);
  send({ type: "card_keep", card: "pick", index: 1 }); await sleep(400);
  const pick = (await cards()).pick;
  check(!pick.options && pick.blocks[0].text === "option B", "card_keep keeps the picked option");
  send({ type: "card_board", card: "pick", board: 2, place: null }); await sleep(400);
  check((await cards()).pick.board === 2, "card_board moves a card to another board");
  send({ type: "card_board", card: "pick", board: 1, place: { x: 560, y: 420 } }); await sleep(300);
  send({ type: "card_close", card: "src" }); await sleep(500);
  const c2 = await cards();
  check(!c2.src && c2.reader.blocks[1].text === 5, "closing a card gives its readers a copy of what they read", JSON.stringify(c2.reader?.blocks?.[1]));

  section("history");
  const h1 = (await get("/history")).body;
  check(h1.line.length >= 8, "every change is a step", `${h1.line.length} steps`);
  let mark = events.length;
  send({ type: "history_undo" });
  check(!!(await waitFor((e) => e.type === "history" && e.event === "moved", 3000, mark)), "history_undo -> event history moved");
  await sleep(300);
  check(!!(await cards()).src, "undo brings the closed card back");
  send({ type: "history_redo" }); await sleep(500);
  check(!(await cards()).src, "redo closes it again");
  send({ type: "history_goto", step: h1.line.at(-3).n }); await sleep(500);
  check((await get("/history")).body.at === h1.line.at(-3).n, "history_goto");
  mark = events.length;
  send({ type: "card_move", card: "form", place: { x: 570, y: 40 } });
  check(!!(await waitFor((e) => e.type === "history" && e.event === "branched", 3000, mark)), "a change after undo branches (event history branched)");
  send({ type: "history_goto", step: (await get("/history")).body.at }); await sleep(200);
  if (!(await cards()).src) { send({ type: "history_undo" }); await sleep(300); }

  section("boards");
  check(JSON.stringify((await get("/board")).body.boards) === "[1,2]", "GET /board");
  mark = events.length;
  send({ type: "board_add" });
  const added = await waitFor((e) => e.type === "board" && e.added, 3000, mark);
  check(added?.added === 3, "board_add -> event board, a new number", JSON.stringify(added));
  send({ type: "board_view", board: 3 }); await sleep(300);
  check((await get("/board")).body.current === 3, "board_view sets the user's board");
  send({ type: "board_view", board: 1 });
  send({ type: "board_remove", board: 3 }); await sleep(300);
  send({ type: "board_remove", board: 2 }); await sleep(600);
  check(JSON.stringify((await get("/board")).body.boards) === "[1]", "board_remove", JSON.stringify((await get("/board")).body));
  check(!(await cards()).far, "a removed board takes its cards with it");
  check(/removed board 2/.test((await get("/history")).body.line.at(-1).what), "...as one undo step", (await get("/history")).body.line.at(-1).what);

  section("frames");
  mark = events.length;
  send({ type: "frame_add", x: 40, y: 600, width: 300, height: 150, board: 1 });
  const fr = await waitFor((e) => e.type === "frame" && Object.keys(e.frames).length, 3000, mark);
  const fid = fr && Object.keys(fr.frames)[0];
  check(fid === "frame-1", "frame_add -> event frame", JSON.stringify(fr));
  send({ type: "frame_text", id: fid, text: "a tiny note pad" });
  send({ type: "frame_place", id: fid, x: 40, y: 610, width: 320, height: 160 }); await sleep(400);
  const f1 = (await get("/frame")).body[fid];
  check(f1?.text === "a tiny note pad" && f1.width === 320, "frame_text, frame_place, GET /frame", JSON.stringify(f1));
  send({ type: "frame_add", x: 400, y: 600, width: 100, height: 100, board: 1 }); await sleep(300);
  send({ type: "frame_remove", id: "frame-2" }); await sleep(300);
  check(!(await get("/frame")).body["frame-2"], "frame_remove");

  section("files and previews");
  const up = await req("POST", "/file/upload?name=costs.csv", "item,cost\npens,3\npaper,5\n");
  check(up.status === 200 && up.body.path?.endsWith("costs.csv"), "upload", JSON.stringify(up.body));
  mark = events.length;
  await req("POST", "/file/upload?name=pic.png", PNG);
  check(!!(await waitFor((e) => e.type === "file" && e.files.some((f) => f.name === "pic.png"), 3000, mark)), "event file after an upload");
  await req("POST", "/file/upload?name=..%2Fescape.txt", "x");
  check(!fs.existsSync(path.join(HOME, "workspace/escape.txt")), "an upload can't leave the drops folder");
  const list = (await get("/file")).body;
  check(list.map((f) => f.name).includes("costs.csv"), "GET /file lists them");
  const view = (await get(`/viewer/view?path=${encodeURIComponent(up.body.path)}`)).body;
  check(JSON.stringify(view).includes("pens"), "a csv preview (/viewer/view)", JSON.stringify(view).slice(0, 150));
  check((await get(`/viewer/raw?path=${encodeURIComponent(path.join(HOME, "workspace/drops/pic.png"))}`)).status === 200, "/viewer/raw");
  check((await get(`/viewer/view?path=${encodeURIComponent("/etc/passwd")}`)).status === 404, "previews only the drops folder");
  const del = await req("POST", "/file/delete", JSON.stringify({ names: ["pic.png", "../../agent/SYSTEM.md"] }));
  check(!fs.existsSync(path.join(HOME, "workspace/drops/pic.png")) && fs.existsSync(path.join(HOME, "agent/SYSTEM.md")), "delete, and not outside the folder", JSON.stringify(del.body));
  const b2 = await browser(["eval:[...document.querySelectorAll('#side .file-row')].map(r=>r.innerText.trim()).join(',')"]);
  check(/costs\.csv/.test(b2.evals[0] ?? "") && b2.errors === 0, "the file panel shows them", b2.evals[0]);

  section("app data");
  mark = events.length;
  check((await req("PUT", "/app/data/notes", JSON.stringify({ a: 1 }))).body.saved === true, "PUT /app/data/<name>");
  check(!!(await waitFor((e) => e.type === "app_data" && e.app === "notes", 3000, mark)), "event app_data");
  check((await get("/app/data/notes")).body.a === 1 && (await get("/app/data/nothing")).body && (await req("PUT", "/app/data/bad%20name", "{}")).status === 400, "GET it back; {} for none; bad names refused");
  check((await get("/app/agents.js")).status === 200 && (await get("/voice/voice.js")).status === 200, "/app/agents.js and /voice/voice.js");

  section("model, mcp, commands, voice, version, screen");
  check((await get("/model/on")).status === 204 && Array.isArray((await get("/model/logins")).body.providers), "/model/on, /model/logins");
  check(Array.isArray((await get("/model/choices")).body.groups), "/model/choices");
  mark = events.length;
  send({ type: "mcp_list" });
  const mcp = await waitFor((e) => e.type === "mcp", 15000, mark);
  check(!!mcp && "gateway" in (mcp.servers ?? {}), "mcp_list -> event mcp with the servers", JSON.stringify(mcp).slice(0, 200));
  const tools = mcp?.servers?.gateway?.tools ?? [];
  check(tools.length > 0, "the gateway's tools are listed", mcp?.error ?? `${tools.length} tools`);
  if (tools.length) {
    send({ type: "mcp_set", server: "gateway", tool: tools[0].name, on: false }); await sleep(1500);
    const off = JSON.parse(fs.readFileSync(path.join(HOME, "agent/mcp.json"), "utf8")).mcpServers.gateway.toolExposure?.[tools[0].name];
    send({ type: "mcp_set", server: "gateway", tool: tools[0].name, on: true }); await sleep(1500);
    check(off === "hidden", "mcp_set turns a tool off (and on again)", String(off));
  }
  const cmds = (await get("/command")).body;
  check(["compact", "thinking", "new"].every((c) => cmds.some((x) => x.name === c)), "GET /command lists compact, thinking, new");
  mark = events.length;
  send({ type: "command", agent: "agent1", text: "/thinking" });
  const th = await waitFor((e) => e.type === "command", 5000, mark);
  check(/thinking/.test(th?.text ?? ""), "the /thinking command answers", JSON.stringify(th));
  check((await get("/voice/config")).body.api === false, "/voice/config (no speech-to-text API set)");
  check((await req("POST", "/voice/transcribe", "x")).status >= 400, "/voice/transcribe refuses without an API");
  const versions = (await get("/versions")).body;
  check(Array.isArray(versions) && versions.length >= 1 && versions.at(-1).message === "original", "GET /versions (the history began as original)");
  const put = (await req("PUT", `/versions/${versions[0].sha}/shot`, PNG)).body;  // saved: false when the page took it first
  check(typeof put.saved === "boolean" && (await get(`/versions/${versions[0].short}/shot`)).status === 200, "a version's picture: PUT (first page wins), GET");
  const shot = await req("POST", "/screen/shot", PNG);
  check(shot.status === 200 && fs.existsSync(shot.body.path ?? ""), "POST /screen/shot");

  if (MODEL) {
    section("agents: tools");
    let t = await turn({ to: "main", text: "Test, keep it short. Call board_list. Then show a card named m1 with one Text block saying ping, then change it to pong with card_update (not card_show)." });
    const names = t.calls.map((c) => c.name);
    check(!t.timedOut && names.includes("board_list") && names.includes("card_show") && names.includes("card_update"), "board_list, card_show, card_update", names.join(","));
    check(JSON.stringify((await cards()).m1?.blocks ?? []).includes("pong"), "the card says pong");
    check((await get("/versions")).body.length > versions.length, "the turn made a version");

    section("agents: team");
    t = await turn({ to: "main", text: "Test, keep it short. Add one helper with team_spawn (role: checker). Use team_ask to ask it to reply with just yes. Then call team_list. Then team_reset it." });
    const tn = t.calls.map((c) => c.name);
    check(["team_spawn", "team_ask", "team_list", "team_reset"].every((n) => tn.includes(n)), "team_spawn, team_ask, team_list, team_reset", tn.join(","));
    check(t.events.some((e) => e.type === "message" && e.agent === "agent2" && e.role === "assistant" && /yes/i.test(e.content ?? "")), "the helper answered");
    mark = events.length;
    send({ type: "command", agent: "agent2", text: "/new" });
    check(/new conversation/.test((await waitFor((e) => e.type === "command" && e.agent === "agent2", 10000, mark))?.text ?? ""), "the /new command on an agent");

    section("agents: notes, combine, card action, app message");
    t = await turn({ type: "note_add", text: "make this say hello there", to: "agent1", target: { card: "m1", blocks: ["root (Text)"], element: "block-text", text: "pong" } });
    const pin = t.events.find((e) => e.type === "note_pin");
    check(!!pin && t.calls.some((c) => c.name === "note_done"), "note_add -> note_pin, the agent calls note_done", t.calls.map((c) => c.name).join(","));
    check(JSON.stringify((await cards()).m1?.blocks).includes("hello there") && Object.keys((await get("/note/all")).body).length === 0, "the note's change is made, and the note is closed");
    t = await turn({ type: "note_combine", text: "show the reader's number next to the form", to: "agent1", a: "reader", b: "form" });
    check(t.calls.some((c) => c.name === "card_show" && /"form"/.test(c.args) && /made_from/.test(c.args)), "note_combine -> card_show of b with made_from", t.calls.map((c) => c.name).join(","));
    t = await turn({ type: "card_action", card: "m1", block: "root", name: "refresh", context: {}, data: (await cards()).m1.data });
    check(t.events.some((e) => e.type === "message" && e.role === "user" && /\[card action\] refresh on card 'm1'/.test(JSON.stringify(e.content))), "card_action wakes the card's owner");
    t = await turn({ type: "app_message", to: "agent1", text: "Reply with just the word app." });
    check(t.events.some((e) => e.type === "message" && /\[message from app/.test(JSON.stringify(e.content))), "app_message reaches an agent, from app");

    section("agents: frames, doodle, screen, viewer");
    t = await turn({ type: "frame_send", to: "agent1", board: 1 });
    check(t.calls.some((c) => c.name === "card_show" && /frame-1/.test(c.args)), "frame_send -> the agent fills frame-1", t.calls.map((c) => c.name).join(","));
    check(!(await get("/frame")).body["frame-1"], "the filled frame goes");
    t = await turn({ type: "doodle_send", to: "agent1", text: "what did I draw? answer in one word", first: [], steps: [{ shot: shot.body.path, area: { x: 0, y: 0, width: 1, height: 1 }, drawn: true, words: ["dot"], then: [] }] });
    check(t.events.some((e) => e.type === "message" && e.role === "user" && /\[doodles on the page\]/.test(JSON.stringify(e.content))), "doodle_send reaches the agent with its steps");
    const answer = (m) => { if (m.type === "screen_ask") send({ type: "screen_reply", id: m.id, shot: shot.body.path, window: { width: 1, height: 1 }, main: { x: 0, y: 0 } }); };
    ws.on("message", (raw) => answer(JSON.parse(raw)));
    t = await turn({ to: "main", text: "Test: call screen_see once and say in one word whether you got a picture." });
    check(t.calls.some((c) => c.name === "screen_see") && t.events.some((e) => e.type === "screen_ask"), "screen_see asks the page, and gets the picture");
    t = await turn({ to: "main", text: `Test: read ${up.body.path} with viewer_read and tell me the cost of paper, as a number only.` });
    check(t.calls.some((c) => c.name === "viewer_read") && t.events.some((e) => e.type === "message" && e.role === "assistant" && /\b5\b/.test(e.content ?? "")), "viewer_read", t.calls.map((c) => c.name).join(","));

    section("agents: changing itself, reload, rollback");
    const guide = path.join(HOME, "agent/extensions/board/guide.md"), before = fs.readFileSync(guide, "utf8");
    const v0 = (await get("/versions")).body[0];
    t = await turn({ to: "main", text: `Test: append the line "- e2e marker." to ${guide}, then call the reload tool with reason "e2e marker".` });
    check(fs.readFileSync(guide, "utf8").includes("e2e marker") && t.calls.some((c) => c.name === "reload"), "an agent edits itself and calls reload");
    check(t.events.some((e) => e.type === "error" && /extensions reloaded/.test(e.text)), "its extensions load again after the turn");
    const v1 = (await get("/versions")).body[0];
    check(v1.message === "e2e marker", "the version's message is the reload reason", v1.message);
    const rb = await req("POST", `/versions/${v0.short}/rollback`);
    check(rb.body.ok === true && fs.readFileSync(guide, "utf8") === before, "rollback puts the guide back");

    section("agents: stop");
    mark = events.length;
    send({ to: "main", text: "Count slowly from 1 to 50, one bash call (sleep 1; echo n) per number." });
    await waitFor((e) => e.type === "run_start", 60000, mark); await sleep(4000);
    send({ type: "stop" });
    check(!!(await waitFor((e) => e.type === "status" && Object.values(e.agents).every((a) => a.state === "idle"), 60000, events.length - 1)), "stop ends a run");
  }
} catch (e) {
  check(false, "the test itself", `${e.stack}${e.cause ? `\ncause: ${e.cause}` : ""}`);
} finally {
  ws.close();
  server.kill();
  console.log(`\n${passed} ok, ${failed} failed${KEEP ? `; home kept: ${HOME}` : ""}`);
  if (failed) console.log(`server log (end):\n${log.slice(-1500)}`);
  if (!KEEP) fs.rmSync(HOME, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
