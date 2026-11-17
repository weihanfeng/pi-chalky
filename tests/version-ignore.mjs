// Regression test for the version history's rule (host.inHistory, server.ts; the loop of 2026-10-27): files the history
// doesn't keep (logins and endpoints in agent/, installed packages anywhere) must never make a commit or a "files that
// aren't part of you" warning. Needs the server running; costs one model call.
//   node tests/version-ignore.mjs            (CHALKY_HOME: that home, else this folder; PORT: the server's, default 3000)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import git from "isomorphic-git";

const ROOT = path.resolve(import.meta.dirname, ".."), HOME = process.env.CHALKY_HOME ? path.resolve(process.env.CHALKY_HOME) : ROOT;
const PORT = process.env.PORT || 3000;
const repo = { fs, dir: HOME, gitdir: path.join(HOME, "data/version/git") };
const KEPT = { filepaths: ["agent", "built"], ignored: true };
const planted = [path.join(HOME, "agent/extensions/card/node_modules/zz-ignore-test/index.js"),
                 path.join(HOME, "built/apps/zz-ignore-test/node_modules/zz-ignore-test/dep.js")];
const logins = ["auth.json", "models-store.json"].map((f) => path.join(HOME, "agent", f)).filter((f) => fs.existsSync(f));
const commits = async () => (await (await fetch(`http://127.0.0.1:${PORT}/versions`)).json()).length;
const sessions = path.join(HOME, "data/sessions/agent1");
const warnings = () => fs.readdirSync(sessions).filter((f) => f.endsWith(".jsonl"))
  .map((f) => (fs.readFileSync(path.join(sessions, f), "utf8").match(/aren't part of you/g) ?? []).length).reduce((a, b) => a + b, 0);

let failed = false;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); failed ||= !ok; };
// changes the history keeps but hasn't saved yet: the next agent turn commits them, which would look like a failure
const real = (await git.statusMatrix({ ...repo, ...KEPT })).filter(([f, h, w, i]) => !(h === 1 && w === 1 && i === 1)
  && !f.split("/").includes("node_modules") && !/^agent\/(auth|models|models-store|mcp-auth)\.json$/.test(f)).map(([f]) => f);
if (real.length) {
  console.log(`not run: agent/ or built/ has changes not in the history yet (${real.join(", ")}); the next agent turn commits them. Run again after.`);
  process.exit(2);
}
try {
  for (const p of planted) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "x"); }
  const now = new Date();
  for (const f of logins) fs.utimesSync(f, now, now);
  const [c0, w0] = [await commits(), warnings()];
  execFileSync(process.execPath, [path.join(ROOT, "tests/say.mjs"), JSON.stringify({ to: "main", text: "Reply with just the word ok. Do not use any tools." })],
    { stdio: "ignore", timeout: 240_000, env: { ...process.env, PORT: String(PORT) } });
  await new Promise((r) => setTimeout(r, 3000));  // the commit runs when the turn has settled
  check(await commits() === c0, `no commit from files the history doesn't keep (versions: ${c0} -> ${await commits()})`);
  check(warnings() === w0, `no "aren't part of you" warning (warnings: ${w0} -> ${warnings()})`);
} finally {
  for (const p of planted) fs.rmSync(path.dirname(p), { recursive: true, force: true });
  for (const d of [path.join(HOME, "built/apps/zz-ignore-test/node_modules"), path.join(HOME, "built/apps/zz-ignore-test")])
    try { fs.rmdirSync(d); } catch {}  // made for the test; removed only if empty
}
process.exit(failed ? 1 : 0);
