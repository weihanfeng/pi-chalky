// Tests for the updates (server.ts, "updates"): fake releases (this repo's server.ts and agent/, version 9.0.x, with
// known changes) started one after another on scratch homes, with every case of the merge checked file by file.
// Each start is a real server (port PORT, default 3290) whose model address is a closed port: no model calls.
//   node tests/update.mjs <work folder> [--npm]   (--npm: also the real path: @chalky/chalky@0.1.5 from the npm
//                                                  registry, then this tree packed as 0.1.6-test installed over it)
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import git from "isomorphic-git";

const ROOT = path.resolve(import.meta.dirname, "..");
const W = path.resolve(process.argv[2] ?? (console.error("give a work folder"), process.exit(2)));
const NPM = process.argv.includes("--npm");
const PORT = Number(process.env.PORT || 3290);
const CHROME = process.env.CHROME;  // a headless Chrome: the notice is also checked on the page
if (await fetch(`http://127.0.0.1:${PORT}/`).then(() => true, () => false)) { console.error(`port ${PORT} is in use: stop that server, or set PORT`); process.exit(2); }
const servers = new Set();  // stopped if the test itself fails
process.on("exit", () => { for (const p of servers) p.kill(); });
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(W, { recursive: true });

let failed = 0, passed = 0;
const check = (ok, what, detail = "") => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n         ${detail}` : ""}`); };
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), what, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const read = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
const NOT_OURS = /(^|\/)(auth\.json|models\.json|models-store\.json|mcp-auth\.json|mcp\.json|node_modules)(\/|$)|\.new$/;

// ---- releases: R1 = this repo's agent/ (as packed) plus fixtures; each later one = the one before plus changes
function release(name, version, from, change = (_a) => {}) {
  const dir = path.join(W, "releases", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "server.ts"), path.join(dir, "server.ts"));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...pkg, version }, null, 2));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  if (from) fs.cpSync(path.join(from, "agent"), path.join(dir, "agent"), { recursive: true });
  else fs.cpSync(path.join(ROOT, "agent"), path.join(dir, "agent"), { recursive: true,  // package.json's "files"
    filter: (s) => !NOT_OURS.test(path.relative(ROOT, s)) && !/^agent\/ui(\/|$)/.test(path.relative(ROOT, s)) });
  change(path.join(dir, "agent"));
  return dir;
}
const w = (p, text, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); if (mode) fs.chmodSync(p, mode); };
const append = (p, line) => fs.appendFileSync(p, line);
const setLine = (p, n, text) => { const l = fs.readFileSync(p, "utf8").split("\n"); l[n - 1] = text; fs.writeFileSync(p, l.join("\n")); };
const bytes = (seed) => Buffer.from(Array.from({ length: 300 }, (_, i) => (i * seed) % 256));  // has zero bytes: binary

const R1 = release("r1", "9.0.0", null, (a) => {
  w(`${a}/skills/design/pic.bin`, bytes(7));
  w(`${a}/skills/design/pic2.bin`, bytes(11));
  w(`${a}/skills/design/run.sh`, "#!/bin/sh\necho one\n", 0o755);
  w(`${a}/skills/design/tool.sh`, "#!/bin/sh\necho tool\n", 0o644);
  w(`${a}/skills/design/crlf.txt`, "line 1\r\nline 2\r\nline 3\r\nline 4\r\nline 5\r\n");
  w(`${a}/skills/design/nonl.txt`, "first\nmiddle\nm2\nm3\nlast");
  w(`${a}/skills/design/uni.md`, "café\n日本語\n— dash\nlast ü\n");
});
const R2 = release("r2", "9.0.1", R1, (a) => {
  append(`${a}/extensions/note/browser.js`, "// release 9.0.1 note\n");                 // only the release
  setLine(`${a}/extensions/card/browser.js`, 1, "// card: 9.0.1 wording");               // the same line as the home
  append(`${a}/extensions/page/page.html`, "<!-- 9.0.1 -->\n");                          // other lines than the home
  append(`${a}/skills/design/SKILL.md`, "\n9.0.1 line\n");                                // the home deleted it
  fs.rmSync(`${a}/skills/write-skill/SKILL.md`);                                          // the home changed it
  fs.rmSync(`${a}/skills/browser-check`, { recursive: true });                             // untouched by the home
  w(`${a}/skills/new-skill/SKILL.md`, "---\nname: new-skill\ndescription: test\n---\nnew in 9.0.1\n");
  w(`${a}/skills/design/pic.bin`, bytes(13));                                             // binary, only the release
  w(`${a}/skills/design/pic2.bin`, bytes(17));                                            // binary, both
  w(`${a}/skills/design/run.sh`, "#!/bin/sh\necho two\n", 0o755);                         // keeps its x bit
  fs.chmodSync(`${a}/skills/design/tool.sh`, 0o755);                                      // only the x bit
  setLine(`${a}/skills/design/crlf.txt`, 5, "line 5 from 9.0.1\r");                       // CRLF, other line than home
  setLine(`${a}/skills/design/nonl.txt`, 1, "first from 9.0.1");                          // no final newline
  setLine(`${a}/skills/design/uni.md`, 2, "日本語 9.0.1");
});
const R3 = release("r3", "9.0.2", R2, (a) => {
  append(`${a}/extensions/note/browser.js`, "// release 9.0.2 note\n");
  setLine(`${a}/extensions/card/browser.js`, 3, "// card line 3: 9.0.2");                 // not the home's line
  setLine(`${a}/extensions/page/page.html`, 20, (read(`${a}/extensions/page/page.html`).split("\n")[19]) + " ");
});

// ---- the home's edits (as agents would make them), and what the home holds that isn't the release's
function edit(home) {
  const a = `${home}/agent`;
  append(`${a}/SYSTEM.md`, "Use British spelling.\n");                                    // only the home
  setLine(`${a}/extensions/card/browser.js`, 1, "// card: square corners (the user's)");
  const page = read(`${a}/extensions/page/page.html`);
  w(`${a}/extensions/page/page.html`, page.replace("<title>Chalky</title>", "<title>My Chalky</title>"));
  fs.rmSync(`${a}/skills/design/SKILL.md`);
  append(`${a}/skills/write-skill/SKILL.md`, "home note\n");
  w(`${a}/skills/design/pic2.bin`, bytes(19));
  setLine(`${a}/skills/design/crlf.txt`, 1, "line 1 from home\r");
  setLine(`${a}/skills/design/nonl.txt`, 5, "last from home");
  setLine(`${a}/skills/design/uni.md`, 4, "last ü 🙂");
  w(`${a}/skills/mine/SKILL.md`, "---\nname: mine\ndescription: the home's own\n---\n");
}
function plant(home) {  // the user's things the history doesn't keep, and what isn't agent/
  w(`${home}/agent/auth.json`, '{"x":{"type":"api_key","key":"SECRET"}}'); w(`${home}/agent/models.json`, "{}"); w(`${home}/agent/mcp-auth.json`, "{}");
  w(`${home}/agent/mcp.json`, '{"mcpServers":{"mine":{}}}');
  w(`${home}/agent/extensions/card/node_modules/x/index.js`, "x");
  w(`${home}/workspace/notes.txt`, "w"); w(`${home}/data/mine.json`, "d");
  w(`${home}/built/card.json`, '{"c1":{}}');  // what an agent made: saved, as the version extension would
  return git.add({ ...repo(home), filepath: "built/card.json" }).then(() => git.add({ ...repo(home), filepath: "agent/mcp.json" })).then(() => git.commit({ ...repo(home), message: "made a card", author: { name: "agent1", email: "agent1@chalky" } }));
}
function planted(home) {
  eq([read(`${home}/agent/auth.json`), read(`${home}/agent/models.json`), read(`${home}/agent/mcp-auth.json`), read(`${home}/agent/mcp.json`),
      read(`${home}/agent/extensions/card/node_modules/x/index.js`), read(`${home}/built/card.json`), read(`${home}/workspace/notes.txt`), read(`${home}/data/mine.json`)],
     ['{"x":{"type":"api_key","key":"SECRET"}}', "{}", "{}", '{"mcpServers":{"mine":{}}}', "x", '{"c1":{}}', "w", "d"], "logins, mcp.json, installed packages, built/, workspace/, data/ untouched");
}

// ---- running a release on a home
let seq = 0;
const home = (name) => path.join(W, "homes", `${String(++seq).padStart(2, "0")} ${name}`);  // a space in every path
async function start(rel, h, { keep = false, ask = true, env = {} } = {}) {
  const log = path.join(W, `start-${seq}-${path.basename(rel)}-${Date.now()}.log`);
  const out = fs.openSync(log, "w");
  const p = spawn(process.execPath, [path.join(rel, "server.ts")], { cwd: rel, stdio: ["ignore", out, out],
    env: { ...process.env, CHALKY_HOME: h, PORT: String(PORT), MODEL_BASE_URL: "http://127.0.0.1:9/v1", MODEL_API_KEY: "test", ...env } });
  servers.add(p);
  const exited = new Promise((r) => p.on("exit", () => { servers.delete(p); r(); }));
  for (let i = 0; i < 120 && !/chalky \(pi\) on/.test(read(log)) && p.exitCode === null; i++) await new Promise((r) => setTimeout(r, 250));
  const up = /chalky \(pi\) on/.test(read(log));
  const update = up && ask ? await fetch(`http://127.0.0.1:${PORT}/versions/update`).then((r) => r.ok ? r.json() : "no route") : undefined;
  const stop = async () => { p.kill(); await exited; };
  if (!keep) await stop();
  return { up, update, log: read(log), stop };
}

// ---- looking at a home
const repo = (h) => ({ fs, dir: h, gitdir: path.join(h, "data/version/git") });
const log = async (h, ref) => (await git.log({ ...repo(h), ref }).catch(() => [])).map((c) => c.commit.message.trim());
const headParents = async (h) => (await git.readCommit({ ...repo(h), oid: await git.resolveRef({ ...repo(h), ref: "main" }) })).commit.parent.length;
async function unsaved(h) {  // files in agent/ and built/ that differ from main (what the history keeps)
  return (await git.statusMatrix({ ...repo(h), filepaths: ["agent", "built"], ignored: true }))
    .filter(([f, hd, wd, ix]) => !(hd === 1 && wd === 1 && ix === 1) && !NOT_OURS.test(f.replace(/\.new$/, ""))).map(([f]) => f);
}
function files(dir, base = dir, out = new Map()) {  // path -> content + x bit, without logins, .new, installed packages
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(base, p);
    if (NOT_OURS.test(rel)) continue;
    if (e.isDirectory()) files(p, base, out);
    else out.set(rel, fs.readFileSync(p).toString("base64") + (fs.statSync(p).mode & 0o100 ? " x" : ""));
  }
  return out;
}
function differ(a, b) {  // the paths where two agent/ folders differ
  const A = files(a), B = files(b);
  return [...new Set([...A.keys(), ...B.keys()])].filter((k) => A.get(k) !== B.get(k)).sort();
}
const news = (h) => (fs.readdirSync(`${h}/agent`, { recursive: true })).filter((f) => f.endsWith(".new")).map((f) => `agent/${f}`).sort();
const message = (h) => {  // agent1's session: the update's message from chalky, if any
  const d = `${h}/data/sessions/agent1`;
  const all = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => read(path.join(d, f))).join("") : "";
  return all.match(/\[message from chalky[^"]*/)?.[0] ?? null;
};
const gitdirStray = (h) => fs.readdirSync(`${h}/data/version/git`).filter((f) => !["HEAD", "config", "description", "index", "objects", "refs", "hooks", "info", "logs", "packed-refs", "ORIG_HEAD", "MERGE_HEAD"].includes(f));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function listed() {  // what the running server lists: the version panel's GET /version, and /recover's rows
  const panel = (await (await fetch(`http://127.0.0.1:${PORT}/versions`)).json()).map((v) => v.message);
  const recover = [...(await (await fetch(`http://127.0.0.1:${PORT}/recover`)).text()).matchAll(/<tr><td>[^<]*<\/td>\s*<td>[^<]*<\/td><td>([^<]*)<\/td>/g)].map((m) => m[1]);
  return { panel, recover };
}

// =====================================================================================================================
console.log("1. a new home");
{
  const h = home("new");
  const s = await start(R1, h);
  check(s.up, "starts");
  eq(s.update, null, "no notice for a new home");
  eq(differ(`${h}/agent`, `${R1}/agent`), [], "agent/ is release 9.0.0 exactly (contents and x bits)");
  eq(await log(h, "main"), ["Started with Chalky 9.0.0", "Chalky 9.0.0"], "main: started with the release");
  eq(await log(h, "package"), ["Chalky 9.0.0"], "package: the release");
  eq(await unsaved(h), [], "the folder is what main saved");
  eq(gitdirStray(h), [], "no stray files in the git folder");
  eq(read(`${h}/agent/mcp.json`), null, "no mcp.json from the release");
  const again = await start(R1, h);
  eq(again.update, null, "restart: nothing to tell");
  eq(await log(h, "main"), ["Started with Chalky 9.0.0", "Chalky 9.0.0"], "restart: no new versions");
}

console.log("2. an update over a home nobody changed; then /recover back to before it");
{
  const h = home("plain update");
  await start(R1, h);
  await plant(h);
  const s = await start(R2, h);
  eq(differ(`${h}/agent`, `${R2}/agent`), [], "agent/ is release 9.0.1 exactly (contents and x bits)");
  eq(s.update && { files: s.update.files, conflicts: s.update.conflicts }, { files: differ(`${R1}/agent`, `${R2}/agent`).length, conflicts: [] },
     "the notice: every changed file, no conflicts");
  eq((await log(h, "main"))[0], "Updated to Chalky 9.0.1", "main: updated");
  eq(await headParents(h), 2, "the update has both parents");
  check(!(await log(h, "main")).some((m) => m.startsWith("Before update")), "no 'Before update' version (nothing unsaved)");
  eq(news(h), [], "no .new files");
  eq(message(h), null, "no message to agent1");
  eq(await unsaved(h), [], "the folder is what main saved");
  planted(h);
  eq(fs.existsSync(`${h}/agent/skills/browser-check`), false, "a removed skill's folder is gone, with its subfolders");
  // the safety net, after an update: back to the version before it
  const s2 = await start(R2, h, { keep: true });
  const before = (await git.log({ ...repo(h), ref: "main" }))[0].commit.parent[0];
  const r = await fetch(`http://127.0.0.1:${PORT}/recover/${before}`, { method: "POST", redirect: "manual" });
  await s2.stop();
  check(r.status < 400, `/recover answers (${r.status})`);
  eq(differ(`${h}/agent`, `${R1}/agent`), [], "/recover: agent/ is 9.0.0 again");
  const s3 = await start(R2, h);
  eq(s3.update, null, "restart after going back: the update isn't made again (going back is the user's choice)");
  eq(differ(`${h}/agent`, `${R1}/agent`), [], "restart after going back: still 9.0.0");
}

console.log("3. every case at once (unsaved home edits), the page's notice, agent1's message");
const H3 = home("all cases");
{
  const h = H3;
  await start(R1, h);
  edit(h); await plant(h);
  const s = await start(R2, h, { keep: true, ask: false });
  const a = `${h}/agent`, d = `${a}/skills/design`;
  if (CHROME) {
    const dom = execFileSync(CHROME, ["--headless", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=15000", "--dump-dom", `http://127.0.0.1:${PORT}/`],
      { timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const notice = dom.match(/<div id="notices"[\s\S]*?Versions\./)?.[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
    check(/Updated to Chalky 9\.0\.1: \d+ files changed\. 4 kept your change; agent1 is merging the update into them\. To undo it, go back a version in Versions\./.test(notice),
      "the page shows the notice", notice || "(no notice in the page)");
  } else console.log("  (skipped: the notice on the page; set CHROME to a headless Chrome)");
  const u = await (await fetch(`http://127.0.0.1:${PORT}/versions/update`)).json();
  if (CHROME) eq(u, null, "the notice is given once (the page took it)");
  await wait(1500);  // agent1 gets its message
  await s.stop();
  const card = read(`${a}/extensions/card/browser.js`).split("\n")[0], cardNew = read(`${a}/extensions/card/browser.js.new`)?.split("\n")[0];
  eq([card, cardNew], ["// card: square corners (the user's)", "// card: 9.0.1 wording"], "same line: the home's stays, the release's is .new");
  eq(read(`${a}/extensions/note/browser.js`), read(`${R2}/agent/extensions/note/browser.js`), "only the release: the release's");
  check(read(`${a}/SYSTEM.md`).endsWith("Use British spelling.\n") && read(`${a}/SYSTEM.md`) === read(`${R1}/agent/SYSTEM.md`) + "Use British spelling.\n", "only the home: the home's");
  const page = read(`${a}/extensions/page/page.html`);
  check(page.includes("<title>My Chalky</title>") && page.endsWith("<!-- 9.0.1 -->\n"), "different lines: both changes");
  eq([fs.existsSync(`${d}/SKILL.md`), read(`${d}/SKILL.md.new`) === read(`${R2}/agent/skills/design/SKILL.md`)], [false, true], "deleted here, changed there: stays deleted, the release's is .new");
  check(read(`${a}/skills/write-skill/SKILL.md`)?.endsWith("home note\n"), "changed here, removed there: the home's is kept");
  eq(fs.existsSync(`${a}/skills/browser-check`), false, "removed there, untouched here: removed (folders too)");
  eq(read(`${a}/skills/new-skill/SKILL.md`), read(`${R2}/agent/skills/new-skill/SKILL.md`), "new in the release: added");
  eq(fs.readFileSync(`${d}/pic.bin`).equals(bytes(13)), true, "binary, only the release: its bytes exactly");
  eq([fs.readFileSync(`${d}/pic2.bin`).equals(bytes(19)), fs.readFileSync(`${d}/pic2.bin.new`).equals(bytes(17))], [true, true], "binary, both: the home's, the release's is .new");
  eq([read(`${d}/run.sh`), fs.statSync(`${d}/run.sh`).mode & 0o777], ["#!/bin/sh\necho two\n", 0o755], "an executable the release changed: new content, still executable");
  eq(fs.statSync(`${d}/tool.sh`).mode & 0o777, 0o755, "only the x bit changed in the release: executable now");
  eq(read(`${d}/crlf.txt`), "line 1 from home\r\nline 2\r\nline 3\r\nline 4\r\nline 5 from 9.0.1\r\n", "CRLF lines: both changes, CRLF kept");
  eq(read(`${d}/nonl.txt`), "first from 9.0.1\nmiddle\nm2\nm3\nlast from home", "no final newline: both changes, still none");
  eq(read(`${d}/uni.md`), "café\n日本語 9.0.1\n— dash\nlast ü 🙂\n", "non-ASCII text: both changes");
  check(fs.existsSync(`${a}/skills/mine/SKILL.md`), "the home's own new skill: kept");
  planted(h);
  const main = await log(h, "main");
  eq(main.slice(0, 3), ["Updated to Chalky 9.0.1", "Chalky 9.0.1", "Before update to Chalky 9.0.1"], "versions: before update (unsaved edits), the release, the update");
  eq(news(h), ["agent/extensions/card/browser.js.new", "agent/skills/design/SKILL.md.new", "agent/skills/design/pic2.bin.new"], "the .new files");
  eq(await unsaved(h), [], "the folder is what main saved (.new files too)");
  const m = message(h) ?? "";
  check(["extensions/card/browser.js", "skills/design/SKILL.md", "skills/write-skill/SKILL.md", "skills/design/pic2.bin"].every((f) => m.includes(f)),
    "agent1's message names all 4 files", m.slice(0, 300));
  eq(gitdirStray(h), [], "no stray files in the git folder");
}

console.log("4. home edits already saved by an agent: no 'Before update' version");
{
  const h = home("saved edits");
  await start(R1, h);
  edit(h);
  const r = repo(h);
  // as the version extension saves (server.ts's stage): every file by its content (git's own check misses a same-size
  // change in the same second), deleted files out
  for (const [f, , wd] of await git.statusMatrix({ ...r, filepaths: ["agent"] }))
    if (!NOT_OURS.test(f)) wd === 0 ? await git.remove({ ...r, filepath: f }) : await git.add({ ...r, filepath: f });
  await git.commit({ ...r, message: "square cards", author: { name: "agent1", email: "agent1@chalky" } });
  const s = await start(R2, h);
  eq((await log(h, "main")).slice(0, 3), ["Updated to Chalky 9.0.1", "Chalky 9.0.1", "square cards"], "versions: the agent's, the release, the update");
  eq(s.update?.conflicts.length, 4, "the same 4 conflicts");
}

console.log("5. the next release while .new files are still waiting (the base is now 9.0.1)");
{
  const h = H3;
  const s = await start(R3, h, { keep: true });
  const shown = await listed();
  await s.stop();
  const mine = ["Updated to Chalky 9.0.2", "Updated to Chalky 9.0.1", "Before update to Chalky 9.0.1", "made a card", "Started with Chalky 9.0.0"];
  eq(shown.panel, mine, "the version panel lists the user's versions only: no releases, none twice, in order");
  eq(shown.recover, mine, "/recover lists the same");
  const a = `${h}/agent`, card = read(`${a}/extensions/card/browser.js`).split("\n");
  eq(s.update?.conflicts, [], "no new conflicts: 9.0.2 changed other lines than the home");
  eq([card[0], card[2]], ["// card: square corners (the user's)", "// card line 3: 9.0.2"], "card: the home's line 1 and 9.0.2's line 3");
  eq(read(`${a}/extensions/card/browser.js.new`)?.split("\n")[0], "// card: 9.0.1 wording", "the waiting .new is left as it was");
  eq(read(`${a}/extensions/note/browser.js`), read(`${R3}/agent/extensions/note/browser.js`), "note: 9.0.2's (9.0.1's change isn't asked again)");
  const page = read(`${a}/extensions/page/page.html`);
  check(page.includes("<title>My Chalky</title>") && page.split("\n")[19].endsWith(" ") && page.endsWith("<!-- 9.0.1 -->\n"), "page.html: the home's title, 9.0.1's and 9.0.2's lines");
  eq((await log(h, "package")), ["Chalky 9.0.2", "Chalky 9.0.1", "Chalky 9.0.0"], "package: three releases");
  eq(await unsaved(h), [], "the folder is what main saved");
}

console.log("6. after agent1 merged a conflict, the next release merges cleanly");
{
  const h = home("resolved");
  await start(R1, h);
  setLine(`${h}/agent/extensions/card/browser.js`, 1, "// card: square corners (the user's)");
  await start(R2, h);
  fs.rmSync(`${h}/agent/extensions/card/browser.js.new`);  // agent1 kept the user's line: the file stays, .new goes
  const r = repo(h);
  await git.remove({ ...r, filepath: "agent/extensions/card/browser.js.new" });
  await git.commit({ ...r, message: "merged the update into card/browser.js", author: { name: "agent1", email: "agent1@chalky" } });
  const s = await start(R3, h);
  const card = read(`${h}/agent/extensions/card/browser.js`).split("\n");
  eq(s.update?.conflicts, [], "no conflicts");
  eq([card[0], card[2]], ["// card: square corners (the user's)", "// card line 3: 9.0.2"], "card: the user's line 1, 9.0.2's line 3");
  eq(news(h), [], "no .new files");
}

console.log("7. skipping a release: 9.0.0 -> 9.0.2");
{
  const h = home("skip");
  await start(R1, h);
  edit(h);
  const s = await start(R3, h);
  eq(read(`${h}/agent/extensions/note/browser.js`), read(`${R3}/agent/extensions/note/browser.js`), "note: both releases' changes");
  eq(read(`${h}/agent/extensions/card/browser.js.new`), read(`${R3}/agent/extensions/card/browser.js`), "card: the same-line conflict, .new is 9.0.2's");
  eq(s.update?.conflicts.length, 4, "4 conflicts, as from 9.0.1");
  eq((await log(h, "package")), ["Chalky 9.0.2", "Chalky 9.0.0"], "package: 9.0.1 never seen");
}

console.log("8. going back to an older release (npm install of an older version)");
{
  const h = home("downgrade");
  await start(R1, h);
  await start(R2, h);
  append(`${h}/agent/SYSTEM.md`, "Use British spelling.\n");
  const s = await start(R1, h);
  eq(differ(`${h}/agent`, `${R1}/agent`), ["SYSTEM.md"], "agent/ is 9.0.0 again, but for the home's edit");
  eq(s.update?.release, "Chalky 9.0.0", "the notice names 9.0.0");
}

console.log("9. going back from an update in the version panel, then the next release");
{
  const h = home("rolled back");
  await start(R1, h);
  append(`${h}/agent/SYSTEM.md`, "Use British spelling.\n");
  const s = await start(R2, h, { keep: true });
  const before = (await git.log({ ...repo(h), ref: "main" }))[0].commit.parent[0];
  const r = await fetch(`http://127.0.0.1:${PORT}/versions/${before}/rollback`, { method: "POST", signal: AbortSignal.timeout(60_000) })
    .then((x) => x.json()).catch((e) => ({ error: String(e) }));
  await s.stop();
  eq(r, { ok: true }, "the rollback answers (to a version with nothing in built/: it used to hang on EISDIR)");
  eq(differ(`${h}/agent`, `${R1}/agent`), ["SYSTEM.md"], "rollback: 9.0.0 with the home's edit");
  eq((await start(R2, h)).update, null, "restart: the update isn't made again");
  const s3 = await start(R3, h);
  console.log(`  (9.0.2 after 9.0.1 was rolled back: ${s3.update?.files} files, conflicts: ${JSON.stringify(s3.update?.conflicts)})`);
  check(s3.update && !s3.update.error, "9.0.2 updates without an error");
  eq(await unsaved(h), [], "the folder is what main saved");
}

console.log("10. an update that fails half-way: the home runs as it was, the next start finishes it");
{
  const h = home("fails");
  await start(R1, h);
  setLine(`${h}/agent/extensions/card/browser.js`, 1, "// card: square corners (the user's)");  // a conflict: a .new before the failure
  const mainBefore = await git.resolveRef({ ...repo(h), ref: "main" });
  fs.chmodSync(`${h}/agent/skills`, 0o555);  // the release can't add new-skill nor remove browser-check
  const s = await start(R2, h);
  fs.chmodSync(`${h}/agent/skills`, 0o755);
  check(s.up, "the server still starts");
  check(/EACCES/.test(s.update?.error ?? ""), "the notice says why", JSON.stringify(s.update));
  check(/update to Chalky 9\.0\.1 failed/.test(s.log), "the log says it failed");
  const mainNow = await git.resolveRef({ ...repo(h), ref: "main" });
  eq((await git.log({ ...repo(h), ref: "main", depth: 2 }))[0].commit.message.trim(), "Before update to Chalky 9.0.1", "main: only the 'Before update' version");
  eq((await git.log({ ...repo(h), ref: "main" }))[1].oid, mainBefore, "main didn't move past it");
  eq(news(h), [], "no .new files left behind");
  eq(await unsaved(h), [], "the folder is what main saved");
  eq(differ(`${h}/agent`, `${R1}/agent`), ["extensions/card/browser.js"], "agent/ is 9.0.0 with the home's edit");
  const s2 = await start(R2, h);
  eq(s2.update?.conflicts.length, 1, "the next start: updated, one conflict");
  eq(await log(h, "package"), ["Chalky 9.0.1", "Chalky 9.0.0"], "package: the release once (not committed twice)");
  eq(differ(`${h}/agent`, `${R2}/agent`), ["extensions/card/browser.js"], "agent/ is 9.0.1 with the home's edit");
  void mainNow;
}

console.log("11. a home made by the code before updates (an 'original' version, no package branch), with an mcp.json");
{
  const old = release("old", "9.0.0", R1, (a) => w(`${a}/mcp.json`, '{"mcpServers":{}}'));  // as 0.1.0 shipped one
  fs.writeFileSync(path.join(old, "server.ts"), execFileSync("git", ["-C", ROOT, "show", "e1f4adb:server.ts"]));
  for (const f of ["index.ts", "browser.js"])
    fs.writeFileSync(path.join(old, "agent/extensions/version", f), execFileSync("git", ["-C", ROOT, "show", `e1f4adb:agent/extensions/version/${f}`]));
  const h = home("old home");
  const s0 = await start(old, h, { keep: true });
  for (let i = 0; i < 40 && !(await log(h, "main")).length; i++) await wait(250);  // it saves its first version after starting
  await s0.stop();
  check(s0.up, "the old code starts a home");
  eq(await log(h, "main"), ["original"], "the old home: one version, 'original'");
  check(read(`${h}/agent/mcp.json`) !== null, "the old home has the mcp.json it was given");
  setLine(`${h}/agent/extensions/card/browser.js`, 1, "// card: square corners (the user's)");
  const s = await start(R2, h, { keep: true });
  const shown = await listed();
  await s.stop();
  eq(s.update?.conflicts.length, 1, "one conflict (the card), so the base was 'original'");
  eq(shown.panel, ["Updated to Chalky 9.0.1", "Before update to Chalky 9.0.1", "original"], "the version panel: the user's versions, 'original' included");
  eq(shown.recover, shown.panel, "/recover lists the same");
  eq(differ(`${h}/agent`, `${R2}/agent`), ["extensions/card/browser.js"], "agent/ is 9.0.1 but for the home's edit (the old code's version extension: replaced)");
  eq(read(`${h}/agent/mcp.json`), '{"mcpServers":{}}', "mcp.json: not removed, though the release has none");
  eq(await log(h, "package"), ["Chalky 9.0.1", "original"], "package: starts from 'original'");
}

console.log("12. the repo itself (node server.ts here, no CHALKY_HOME): no updates");
{
  const dev = release("dev", "9.0.0", R1);
  const s = await start(dev, dev, { env: { CHALKY_HOME: "" } });
  check(s.up, "starts");
  eq(s.update, null, "no update");
  eq(await log(dev, "package"), [], "no package branch");
  eq(differ(`${dev}/agent`, `${R1}/agent`), [], "agent/ untouched");
}

// ---- the real path: npm install of the published 0.1.5, then this tree packed and installed over it
if (NPM) {
  console.log("13. npm: @chalky/chalky@0.1.5 from the registry, then this tree as 0.1.6-test, then 0.1.7-test");
  const prefix = path.join(W, "npm"), bin = path.join(prefix, "bin/chalky"), h = home("npm home");
  const npm = (...a) => execFileSync("npm", a, { stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 }).toString();
  npm("install", "-g", "--prefix", prefix, "@chalky/chalky@0.1.5");
  const run = async () => {
    const file = path.join(W, `npm-${Date.now()}.log`), out = fs.openSync(file, "w");
    const p = spawn(bin, [], { stdio: ["ignore", out, out], env: { ...process.env, CHALKY_HOME: h, PORT: String(PORT), MODEL_BASE_URL: "http://127.0.0.1:9/v1", MODEL_API_KEY: "test" } });
    const exited = new Promise((r) => p.on("exit", r));
    for (let i = 0; i < 240 && !/chalky \(pi\) on/.test(read(file)) && p.exitCode === null; i++) await wait(250);
    for (let i = 0; i < 40 && !(await log(h, "main")).length; i++) await wait(250);  // 0.1.5 saves its first version after starting
    const update = /chalky \(pi\) on/.test(read(file)) ? await (await fetch(`http://127.0.0.1:${PORT}/versions/update`)).json().catch(() => "no route") : "did not start: " + read(file);
    p.kill(); await exited;
    return update;
  };
  const pack = (version, change = () => {}) => {  // a clean copy of this tree (as git would check it out, plus our edits), packed
    const dir = path.join(W, `pack-${version}`);
    fs.cpSync(ROOT, dir, { recursive: true, filter: (s) => { const r = path.relative(ROOT, s); return !/^(node_modules|data|built|workspace|NOTES\.md|\.git)(\/|$)/.test(r) && !NOT_OURS.test(r) && !/^agent\/ui(\/|$)/.test(r); } });
    fs.cpSync(path.join(ROOT, "node_modules/xlsx"), path.join(dir, "node_modules/xlsx"), { recursive: true });  // bundled
    const pkg = JSON.parse(read(path.join(dir, "package.json")));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...pkg, version }, null, 2));
    change(path.join(dir, "agent"));
    return path.join(dir, execFileSync("npm", ["pack", "--silent"], { cwd: dir }).toString().trim().split("\n").pop());
  };
  eq(await run(), "no route", "0.1.5 starts a home (it has no update route)");
  const installed = path.join(prefix, "lib/node_modules/@chalky/chalky");
  setLine(`${h}/agent/SYSTEM.md`, 1, "You are Chalky, and you use British spelling.");
  w(`${h}/agent/mcp.json`, '{"mcpServers":{"mine":{}}}');
  const t6 = pack("0.1.6-test");
  npm("install", "-g", "--prefix", prefix, t6);
  const u6 = await run();
  check(u6?.release === "Chalky 0.1.6-test" && !u6.error, "0.1.6-test updates the home", JSON.stringify(u6)?.slice(0, 300));
  eq(differ(`${h}/agent`, `${installed}/agent`), ["SYSTEM.md"], "agent/ is the installed package's, but for the home's edit");
  check(read(`${h}/agent/SYSTEM.md`).startsWith("You are Chalky, and you use British spelling."), "the home's edit is kept");
  eq(read(`${h}/agent/mcp.json`), '{"mcpServers":{"mine":{}}}', "the user's mcp.json is kept");
  eq(await log(h, "package"), ["Chalky 0.1.6-test", "original"], "package: from 'original'");
  const t7 = pack("0.1.7-test", (a) => append(`${a}/extensions/note/browser.js`, "// 0.1.7-test\n"));
  npm("install", "-g", "--prefix", prefix, t7);
  const u7 = await run();
  eq(u7 && { files: u7.files, conflicts: u7.conflicts }, { files: 1, conflicts: [] }, "0.1.7-test: one file, no conflicts");
  eq(differ(`${h}/agent`, `${installed}/agent`), ["SYSTEM.md"], "agent/ is 0.1.7-test's, but for the home's edit");
  eq(await unsaved(h), [], "the folder is what main saved");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
