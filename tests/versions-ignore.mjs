// Regression test for the versions plugin's ignore filter (the loop of 2026-10-27): ignored files in app/ must never
// make a commit or a "files that aren't your code" warning. Needs the server running; costs one model call.
//   node tests/versions-ignore.mjs
// Also says whether isomorphic-git's statusMatrix still misses <gitdir>/info/exclude (then our filter is still needed).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import git from "isomorphic-git";

const ROOT = path.resolve(import.meta.dirname, ".."), APP = path.join(ROOT, "app"), repo = { fs, dir: APP, gitdir: path.join(ROOT, "state/versions.git") };
const planted = [path.join(APP, "ui/node_modules/zz-ignore-test/index.js"), path.join(APP, "ui/apps/groceries/node_modules/zz-ignore-test/dep.js")];
const commits = async () => (await (await fetch("http://127.0.0.1:3000/versions")).json()).length;
const notes = () => fs.readdirSync(path.join(ROOT, "state/sessions/agent1")).filter((f) => f.endsWith(".jsonl"))
  .map((f) => (fs.readFileSync(path.join(ROOT, "state/sessions/agent1", f), "utf8").match(/aren't your code/g) ?? []).length).reduce((a, b) => a + b, 0);

let failed = false;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); failed ||= !ok; };
const real = [];  // changes that aren't ignored: the next agent turn commits them, which would look like a failure
for (const [f, h, w, i] of await git.statusMatrix(repo))
  if (!(h === 1 && w === 1 && i === 1) && !(h === 0 && i === 0 && await git.isIgnored({ ...repo, filepath: f }))) real.push(f);
if (real.length) {
  console.log(`not run: app/ has changes not in the history yet (${real.join(", ")}); the next agent turn commits them. Run again after.`);
  process.exit(2);
}
try {
  for (const p of planted) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "x"); }
  const now = new Date();
  for (const f of ["auth.json", "models-store.json"]) if (fs.existsSync(path.join(APP, f))) fs.utimesSync(path.join(APP, f), now, now);

  const rows = (await git.statusMatrix(repo)).filter(([, h, w, i]) => !(h === 1 && w === 1 && i === 1)).map(([f]) => f);
  const missed = rows.filter((f) => f.includes("zz-ignore-test") || f === "auth.json");
  console.log(missed.length ? `info isomorphic-git still has the bug (statusMatrix reports ${missed.join(", ")}): keep the filter`
    : "info isomorphic-git's statusMatrix now honours info/exclude: the isIgnored filter in versions.ts could go");

  const [c0, n0] = [await commits(), notes()];
  execFileSync(process.execPath, [path.join(ROOT, "tests/say.mjs"), JSON.stringify({ to: "main", text: "Reply with just the word ok. Do not use any tools." })],
    { stdio: "ignore", timeout: 240_000 });
  await new Promise((r) => setTimeout(r, 3000));  // the commit runs when the turn has settled
  check(await commits() === c0, `no commit from ignored files (versions: ${c0} -> ${await commits()})`);
  check(notes() === n0, `no "aren't your code" warning (warnings: ${n0} -> ${notes()})`);
} finally {
  for (const p of planted) fs.rmSync(path.dirname(p), { recursive: true, force: true });
  try { fs.rmdirSync(path.join(APP, "ui/apps/groceries/node_modules")); } catch {}  // made for the test; removed only if empty
}
process.exit(failed ? 1 : 0);
