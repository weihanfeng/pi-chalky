// Tests for the version history (the version extension and server.ts's host.history, /recover): real agent turns
// against a fake model, so every version is made the way it is in use (pi's agent_settled), with no model costs.
// The fake model is an OpenAI chat-completions endpoint that reads a plan from the message: a line "PLAN {...}",
//   {"steps": [[{"name": "write", "args": {...}}, ...], ...], "wait": ms}
// each step one reply of tool calls (pi runs them), then after "wait" ms the final reply "Done.".
//   node tests/versions.mjs <work folder>   (PORT: default 3291; the fake model takes any free port)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import git from "isomorphic-git";
import WebSocket from "ws";

const ROOT = path.resolve(import.meta.dirname, "..");
const W = path.resolve(process.argv[2] ?? (console.error("give a work folder"), process.exit(2)));
const PORT = Number(process.env.PORT || 3291), URL = `http://127.0.0.1:${PORT}`;
if (await fetch(`${URL}/`).then(() => true, () => false)) { console.error(`port ${PORT} is in use: stop that server, or set PORT`); process.exit(2); }
let server;
process.on("exit", () => server?.kill());
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });

let failed = 0, passed = 0;
const check = (ok, what, detail = "") => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n         ${detail}` : ""}`); };
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), what, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;

// ---- the fake model
const served = [];  // final replies sent: {plan id}
const model = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => body += c);
  req.on("end", async () => {
    const { messages } = JSON.parse(body);
    const text = (m) => typeof m.content === "string" ? m.content : (m.content ?? []).map((c) => c.text ?? "").join("\n");
    const at = messages.findLastIndex((m) => m.role === "user" && /^PLAN /m.test(text(m)));
    const plan = at < 0 ? { steps: [] } : JSON.parse(text(messages[at]).match(/^PLAN (.*)$/m)[1]);
    const step = messages.slice(at + 1).filter((m) => m.role === "assistant").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", model: "default",
      choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const calls = plan.steps[step];
    if (calls) {
      send({ role: "assistant", tool_calls: calls.map((c, i) => ({ index: i, id: `call_${step}_${i}`, type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
      send({}, "tool_calls");
    } else {
      if (plan.wait) await sleep(plan.wait);
      send({ role: "assistant", content: "Done." });
      send({}, "stop");
      served.push(plan.id);
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const MODEL = `http://127.0.0.1:${model.address().port}/v1`;

// ---- a release (as packed) and a home, with agent2 saved by an "earlier run" so it starts too
const NOT_OURS = /(^|\/)(auth\.json|models\.json|models-store\.json|mcp-auth\.json|mcp\.json|node_modules)(\/|$)|\.new$/;
const REL = path.join(W, "release"), HOME = path.join(W, "home with space");
fs.mkdirSync(REL, { recursive: true });
fs.copyFileSync(path.join(ROOT, "server.ts"), path.join(REL, "server.ts"));
fs.writeFileSync(path.join(REL, "package.json"), JSON.stringify({ ...JSON.parse(read(path.join(ROOT, "package.json"))), version: "9.1.0" }, null, 2));
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(REL, "node_modules"));
fs.cpSync(path.join(ROOT, "agent"), path.join(REL, "agent"), { recursive: true,
  filter: (s) => !NOT_OURS.test(path.relative(ROOT, s)) && !/^agent\/ui(\/|$)/.test(path.relative(ROOT, s)) });
fs.mkdirSync(path.join(HOME, "data/sessions/agent2"), { recursive: true });
fs.writeFileSync(path.join(HOME, "data/sessions/agent2/role.json"), JSON.stringify({ role: "a helper" }));

const LOG = path.join(W, "server.log");
server = spawn(process.execPath, [path.join(REL, "server.ts")], { cwd: REL, stdio: ["ignore", fs.openSync(LOG, "w"), fs.openSync(LOG, "a")],
  env: { ...process.env, CHALKY_HOME: HOME, PORT: String(PORT), MODEL_BASE_URL: MODEL, MODEL_API_KEY: "test", MODEL_NAME: "default" } });
for (let i = 0; i < 120 && !/chalky \(pi\) on/.test(read(LOG)); i++) await sleep(250);
if (!/chalky \(pi\) on/.test(read(LOG))) { console.error(read(LOG)); process.exit(1); }

// ---- talking to it as the page does
const events = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.on("message", (raw) => { const e = JSON.parse(String(raw)); if (e.type === "version") events.push(e); });
await new Promise((r) => ws.on("open", r));
const page = (data) => ws.send(JSON.stringify(data));
let plans = 0;
// a message to an agent with a plan; resolves when its turn is over, with its version event (or null: none within 3 s)
async function turn(agent, ask, steps, { wait = 0 } = {}) {
  const id = ++plans, from = events.length;
  page({ type: "chat", to: agent, text: `${ask}\nPLAN ${JSON.stringify({ id, steps, wait })}` });
  for (let i = 0; i < 400 && !served.includes(id); i++) await sleep(50);
  for (let i = 0; i < 60; i++) { const e = events.slice(from).find((e) => e.agent === agent); if (e) return e; await sleep(50); }
  return null;
}
const write = (rel, content) => ({ name: "write", args: { path: path.join(HOME, rel), content } });
const bash = (command) => ({ name: "bash", args: { command: `cd '${HOME}' && ${command}` } });
const versions = async () => (await fetch(`${URL}/version`)).json();  // also waits for the history's queued work
const top = async () => (await versions())[0];
const rollback = (sha) => fetch(`${URL}/version/${sha}/rollback`, { method: "POST" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const repo = { fs, dir: HOME, gitdir: path.join(HOME, "data/version/git") };
const filesIn = async (sha) => {  // what a version changed, compared with its first parent
  const c = (await git.readCommit({ ...repo, oid: sha })).commit, out = [];
  await git.walk({ ...repo, trees: [git.TREE({ ref: c.parent[0] }), git.TREE({ ref: sha })], map: async (f, [a, b]) => {
    if (f === ".") return true;
    if ((await a?.type()) === "tree" || (await b?.type()) === "tree") return true;
    if ((await a?.oid()) !== (await b?.oid()) || (await a?.mode()) !== (await b?.mode())) out.push(f);
    return true;
  } });
  return out.sort();
};
const blob = async (sha, filepath) => Buffer.from((await git.readBlob({ ...repo, oid: sha, filepath }).catch(() => ({ blob: null }))).blob ?? "").toString() || null;
const at = (rel) => read(path.join(HOME, rel));

console.log("\n1. the first version");
let v = await versions();
eq(v.map((x) => [x.author, x.message]), [["chalky", "Started with Chalky 9.1.0"]], "a new home starts with one version, the release");
check(v[0].current, "it is marked current");
const START = v[0].sha;

console.log("\n2. a turn that changes files: one version, by that agent, labelled with what changed");
let e = await turn("agent1", "make a note about cats", [[write("built/notes/cats.txt", "cats\n")]]);
check(e, "a version event reached the page", "none within 3 s");
let t = await top();
eq([t.author, t.message], ["agent1", "new notes/cats.txt"], "author and label (what changed)");
eq(await filesIn(t.sha), ["built/notes/cats.txt"], "it holds exactly the changed file");
eq(e?.files, ["built/notes/cats.txt"], "the event names the same files");
const CATS = t.sha;

console.log("\n3. a turn that changes nothing: no version");
const n = (await versions()).length;
e = await turn("agent1", "just say hi", []);
check(!e, "no version event");
eq((await versions()).length, n, "the list is unchanged");

console.log("\n4. files the history doesn't keep (a login) are no version");
e = await turn("agent1", "touch my login", [[write("agent/auth.json", "{}")]]);
check(!e, "no version for agent/auth.json alone");

console.log("\n5. tricky files: a picture, the x bit only, a same-size edit within the same second");
const PIC = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) % 256)).toString("base64");
e = await turn("agent1", "make a picture and a script", [[bash(`mkdir -p built/pic && echo ${PIC} | base64 -d > built/pic/a.png && printf '#!/bin/sh\\necho hi\\n' > built/pic/run.sh`)]]);
const PICV = (await top()).sha;
eq(await filesIn(PICV), ["built/pic/a.png", "built/pic/run.sh"], "picture and script saved");
e = await turn("agent1", "make the script runnable", [[bash("chmod +x built/pic/run.sh")]]);
check(e, "the x bit alone makes a version");
t = await top();
eq(await filesIn(t.sha), ["built/pic/run.sh"], "holding only that script");
const runMode = (await git.walk({ ...repo, trees: [git.TREE({ ref: t.sha })], map: async (f, [x]) => f === "built/pic/run.sh" ? x.mode() : undefined })).flat(Infinity).find(Boolean);
eq(runMode?.toString(8), "100755", "saved as executable");
e = await turn("agent1", "write AAAA", [[write("built/r.txt", "AAAA")]]);
const t0 = Date.now();
e = await turn("agent1", "write BBBB", [[write("built/r.txt", "BBBB")]]);
console.log(`         (the second write came ${Date.now() - t0} ms after the first version, ${Math.floor(fs.statSync(path.join(HOME, "built/r.txt")).mtimeMs / 1000) === Math.floor(t0 / 1000) ? "within" : "not within"} the same second)`);
check(e, "the same-size edit makes a version");
eq(await blob((await top()).sha, "built/r.txt"), "BBBB", "holding the new text");

console.log("\n6. two agents working at the same time");
const [e1, e2] = await Promise.all([
  turn("agent1", "agent1 part", [[write("built/both/one.txt", "1")]], { wait: 300 }),
  turn("agent2", "agent2 part", [[write("built/both/two.txt", "2")]], { wait: 1500 })]);
check(e1, "agent1 got a version");
check(e2, "agent2 got a version", "none: its file was saved in agent1's");
const both = (await versions()).slice(0, 2);
const holds = Object.fromEntries(await Promise.all(both.map(async (x) => [x.author, await filesIn(x.sha)])));
eq(holds.agent1, ["built/both/one.txt"], "agent1's version holds only agent1's file");
eq(holds.agent2, ["built/both/two.txt"], "agent2's version holds only agent2's file");

console.log("\n7. your own page actions (they change built/)");
e = await turn("agent1", "show a card", [[{ name: "card_show", args: { card: "c1", blocks: [{ id: "root", block: "Text", text: "hi" }] } }]]);
check(e?.files?.includes("built/card.json"), "an agent's card is a version", JSON.stringify(e?.files));
const CARD = (await top()).sha;
let from = events.length;
page({ type: "card_pin", card: "c1", pinned: true });
page({ type: "board_add" });
await sleep(1500);
check(JSON.parse(at("built/card.json") ?? "{}").c1?.pinned === true && fs.existsSync(path.join(HOME, "built/board.json")), "the page actions changed built/card.json and built/board.json");
check(events.length > from, "the page actions made a version of their own (author user)", "none: they are unsaved until an agent's turn ends");
e = await turn("agent2", "agent2 writes a file", [[write("built/other.txt", "x")]]);
eq(e?.files?.sort(), ["built/other.txt"], "agent2's next version holds only agent2's file", );

console.log("\n8. rollback");
const before = (await versions()).length;
fs.writeFileSync(path.join(HOME, "built/unsaved.txt"), "mine");  // a change no turn has saved
let r = await rollback(CATS);
eq(r, { status: 200, body: { ok: true } }, "rollback answers ok");
v = await versions();
eq(v.slice(0, 2).map((x) => [x.author, x.message]), [["user", `rollback to ${CATS.slice(0, 7)} new notes/cats.txt`], ["user", "uncommitted changes before rollback"]],
  "the unsaved change is saved first, then the rollback is a new version");
eq(v.length, before + 2, "nothing is removed from the list");
check((await filesIn(v[1].sha)).includes("built/unsaved.txt"), "the unsaved file is in the saved version");
eq([at("built/notes/cats.txt"), at("built/unsaved.txt"), at("built/r.txt"), fs.existsSync(path.join(HOME, "built/pic")), fs.existsSync(path.join(HOME, "built/both"))],
  ["cats\n", null, null, false, false], "files are as they were; later files and their folders are gone");
const cards = await (await fetch(`${URL}/card/all`)).json();
check(!cards.c1, "the page's cards are read again (c1 is gone)");
r = await rollback(v[1].sha);
eq([r.status, at("built/unsaved.txt"), JSON.parse(at("built/card.json") ?? "{}").c1?.pinned], [200, "mine", true], "rolling back the rollback brings everything back");
r = await rollback(PICV);
eq([r.status, fs.readFileSync(path.join(HOME, "built/pic/a.png")).toString("base64"), (fs.statSync(path.join(HOME, "built/pic/run.sh")).mode & 0o111) === 0],
  [200, PIC, true], "the picture comes back byte for byte, the script without its x bit");
r = await rollback(START);
eq([r.status, fs.readdirSync(path.join(HOME, "built"), { recursive: true }).filter((f) => fs.statSync(path.join(HOME, "built", f)).isFile())],
  [200, []], "back to the first version (no files in built/; server.ts keeps an empty apps/)");
eq(await (async () => { const s = await git.statusMatrix({ ...repo, filepaths: ["agent", "built"] });
  return s.filter(([f, h, w2, i]) => !(h === 1 && w2 === 1 && i === 1) && !NOT_OURS.test(f)).map(([f]) => f); })(), [], "nothing unsaved after it");
r = await rollback(CARD);
eq([r.status, (await (await fetch(`${URL}/card/all`)).json()).c1 ? "c1" : null], [200, "c1"], "and forward again to the card");

console.log("\n9. rollback while an agent is working");
from = events.length;
const working = turn("agent1", "a slow job", [[write("built/slow.txt", "half")]], { wait: 4000 });
for (let i = 0; i < 100 && !at("built/slow.txt"); i++) await sleep(50);
r = await rollback(CATS);
eq(r.status, 200, "rollback answers ok");
v = await versions();
eq([v[1].author, v[1].message], ["agent1", "new slow.txt"], "stopping the agent ends its turn: its half-done file is its own version, first");
eq(await filesIn(v[1].sha), ["built/slow.txt"], "holding that file");
check(!at("built/slow.txt"), "and it is gone after the rollback");
await Promise.race([working, sleep(6000)]);
eq((await top()).message, `rollback to ${CATS.slice(0, 7)} new notes/cats.txt`, "the stopped turn adds no version after the rollback");

console.log("\n10. /recover");
fs.writeFileSync(path.join(HOME, "built/unsaved2.txt"), "mine too");
const rows = [...(await (await fetch(`${URL}/recover`)).text()).matchAll(/<td>([^<]*)<\/td><td>([^<]*)<\/td>/g)].map((m) => m[2]);
eq(rows, (await versions()).map((x) => x.message), "it lists the same versions as the Versions panel");
let res = await fetch(`${URL}/recover/${START}`, { method: "POST", redirect: "manual" });
v = await versions();
eq([res.status, v[0].message, v[1].message], [303, `recover to ${START.slice(0, 7)} Started with Chalky 9.1.0`, "uncommitted changes before recovery"], "recover saves first, then goes back");
check((await filesIn(v[1].sha)).includes("built/unsaved2.txt") && !at("built/unsaved2.txt"), "the unsaved file is saved, then gone");
res = await fetch(`${URL}/recover/${CARD}`, { method: "POST", redirect: "manual" });
eq([res.status, (await (await fetch(`${URL}/card/all`)).json()).c1 ? "c1" : null], [303, "c1"], "recover forward to the card");
res = await fetch(`${URL}/recover/0000000`, { method: "POST", redirect: "manual" });
eq(res.status, 404, "an unknown version: 404");
r = await fetch(`${URL}/version/zzz/rollback`, { method: "POST" });
eq(r.status, 400, "a malformed version: 400");

console.log("\n11. labels: what changed, in words");
const full = async () => (await git.readCommit({ ...repo, oid: (await top()).sha })).commit.message.trim();
e = await turn("agent1", "please add a second card for the trip", [[{ name: "card_show", args: { card: "c2", blocks: [{ id: "root", block: "Text", text: "two" }] } }]]);
eq(await full(), "showed c2\n\nplease add a second card for the trip", "a card: the card's words; the request as the second line");
eq(e?.message, "showed c2", "the page's event carries the label only");
await turn("agent1", "make an app", [[write("built/apps/planner/index.html", "<p>plan</p>"), write("built/apps/planner/app.js", "1")]]);
eq((await top()).message, "new app planner", "an app's files: one thing");
await turn("agent1", "calmer notes", [[bash("echo '// calmer' >> agent/extensions/note/browser.js && echo calm >> agent/skills/design/SKILL.md")],
  [{ name: "reload", args: { reason: "notes look calmer" } }]]);
eq((await top()).message, "changed extension note; changed skill design: notes look calmer", "an extension and a skill, then the reload reason");
await turn("agent1", "edit the app", [[bash("echo 2 > built/apps/planner/app.js && rm built/apps/planner/index.html")]]);
eq((await top()).message, "changed app planner", "a thing with a file changed and one removed: changed");
await turn("agent1", "drop the app", [[bash("rm -r built/apps/planner")]]);
eq((await top()).message, "removed app planner", "all its files gone: removed");
await turn("agent1", "many files", [[bash("mkdir -p built/many && for i in 1 2 3 4 5; do echo $i > built/many/$i.txt; done")]]);
eq((await top()).message, "new many/1.txt; new many/2.txt; new many/3.txt and 2 more", "at most 3 things, then how many more");
page({ type: "card_pin", card: "c2", pinned: true });
await turn("agent1", "write x", [[bash("echo x > built/x.txt")]]);
eq(await full(), "changed cards; new x.txt\n\nwrite x", "the user's unsaved pin: no words of the agent's, so just \"changed cards\"");
const line = (await (await fetch(`${URL}/history`)).json()).line.map((s) => s.what);
check(line.includes("agent1 showed c2") && line.includes("you pinned c2"), "the undo history still says who: \"agent1 showed c2\", \"you pinned c2\"", JSON.stringify(line.slice(-4)));

console.log("\n12. after a restart");
const count = (await versions()).length;
server.kill();
await new Promise((r) => server.on("exit", r));
fs.writeFileSync(LOG, "");
server = spawn(process.execPath, [path.join(REL, "server.ts")], { cwd: REL, stdio: ["ignore", fs.openSync(LOG, "a"), fs.openSync(LOG, "a")],
  env: { ...process.env, CHALKY_HOME: HOME, PORT: String(PORT), MODEL_BASE_URL: MODEL, MODEL_API_KEY: "test", MODEL_NAME: "default" } });
for (let i = 0; i < 120 && !/chalky \(pi\) on/.test(read(LOG)); i++) await sleep(250);
eq((await versions()).length, count, "the same release again: no new version, the list unchanged");

console.log(`\n${passed} passed, ${failed} failed  (server log: ${LOG})`);
ws.close(); model.close(); server.kill();
process.exit(failed ? 1 : 0);
