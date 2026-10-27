// Version history of the agents' own code, app/ (port of the Python versions plugin; the page's Versions panel is
// unchanged). The history is a git repo kept OUTSIDE app/, in state/versions.git (the idea of pi-workspace-history):
// app/ has no .git, so an agent's own git commands can't rewrite it. Its first commit is app/ as it was the first
// time, tagged "original". Git through isomorphic-git (pure JS; no git program needed), one operation at a time.
//   - When an agent's turn is over (pi's agent_settled) and app/ changed: commit, author = that agent, message =
//     its reload reason, else what it was asked (Python: what it first said, often just "done"), else what it said.
//     Event "version" to the pages ({agent, sha, message, files, restart: false}: they refresh what changed).
//   - Pictures for the panel: taken by the open page itself (browser.js here, with dom-to-image-more; no
//     headless browser), after each new version and, when a page opens, for the current version if it has none.
//     In state/shots/<sha>.png. A version made while no page was open and changed again before one opened: none.
//   - GET  /versions                 commits, newest first ({sha, short, author, date, message, current, shot})
//     GET  /versions/<sha>/shot      that commit's picture (404 if none; HEAD too)
//     PUT  /versions/<sha>/shot      the page's picture (PNG, at most 10 MB; {saved: false} if it has one: the first page wins)
//     POST /versions/<sha>/rollback  that commit's files as a NEW commit (history is never rewritten, so a rollback
//                                    can be rolled back). The Python agent restarted its process; here: stop every
//                                    agent, put the files back, reload every agent's extensions (pi's reload), read
//                                    the surfaces again, and tell each agent (an fyi: no turn).
//   - Not ported: pip freeze (Python's library list per version).
// Ignored (info/exclude in the history repo): pi's auth.json and models-store.json (logins), node_modules/.
// Guard: app/ is the agents' code. If a commit includes other files, its agent is told to move them to the
// workspace: a rollback would undo them.
import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const GIT_DIR = path.join(host.state, "versions.git");
const SHOTS = path.join(host.state, "shots");
const MAX_SHOT = 10 * 1024 * 1024;
const CODE = ["extensions/", "skills/", "ui/"];
const IGNORE = ["auth.json", "models-store.json", "node_modules/"];
const repo = { fs, dir: host.app, gitdir: GIT_DIR };
const who = (name: string) => ({ name, email: `${name}@chalky` });

const shared = host.shared.get("versions") ?? { queue: Promise.resolve(), turnFrom: {} as Record<string, number> };
host.shared.set("versions", shared);
function queued<T>(fn: () => Promise<T>): Promise<T> {  // history operations one at a time (agents can finish together)
  const run = shared.queue.then(fn);
  shared.queue = run.catch(() => {});
  return run;
}

async function stage() {  // git add -A: every change in app/ into the index; the changed paths
  const changed = [];
  for (const [filepath, head, workdir, index] of await git.statusMatrix(repo)) {
    if (head === 1 && workdir === 1 && index === 1) continue;  // unchanged
    // new files: statusMatrix (1.44.2) checks ignores without our gitdir, so it misses info/exclude; isIgnored doesn't
    if (head === 0 && index === 0 && await git.isIgnored({ ...repo, filepath })) continue;
    if (workdir === 0) { if (index !== 0) await git.remove({ ...repo, filepath }); }
    else await git.add({ ...repo, filepath });
    changed.push(filepath);
  }
  return changed;
}

if (!fs.existsSync(GIT_DIR) && !shared.creating) shared.creating = queued(async () => {  // the first time (once, though every agent loads this): the history starts with app/ as it is
  await git.init({ ...repo, defaultBranch: "main" });
  fs.writeFileSync(path.join(GIT_DIR, "info/exclude"), IGNORE.join("\n") + "\n");
  await stage();
  await git.commit({ ...repo, message: "original", author: who("chalky") });
  await git.tag({ ...repo, ref: "original" });
});

const head = async () => { await shared.queue; return git.resolveRef({ ...repo, ref: "HEAD" }); };  // after queued work (e.g. the first commit)

async function commit(author: string, message: string) {  // the changed files, or [] if nothing changed
  const changed = await stage();
  if (!changed.length) return [];
  let sha: string;
  try { sha = await git.commit({ ...repo, message, author: who(author), disallowEmpty: true }); }
  catch (e: any) { if (e.code === "EmptyCommitError") return []; throw e; }  // nothing really changed
  host.broadcast("version", { agent: author, sha: sha.slice(0, 7), message, files: changed, restart: false });  // pages take its picture
  return changed;
}

const textOf = (m: any) => typeof m.content === "string" ? m.content
  : (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", (_e, ctx) => { shared.turnFrom[pi.getSessionName()!] = ctx.sessionManager.getEntries().length; });
  pi.on("agent_settled", (_e, ctx) => {
    const agent = pi.getSessionName()!;
    const turn = ctx.sessionManager.getEntries().slice(shared.turnFrom[agent] ?? 0).filter((e: any) => e.type === "message").map((e: any) => e.message);
    const reason = host.shared.get(`reload-reason ${agent}`);
    host.shared.delete(`reload-reason ${agent}`);
    let message = "";
    for (const text of [reason ?? "", ...turn.filter((m: any) => m.role === "user").map(textOf), ...turn.filter((m: any) => m.role === "assistant").map(textOf)]) {
      const line = text.split("\n").map((l: string) => l.trim()).find((l: string) => l && !/^\[\w+ (from|to) /.test(l));
      if (line) { message = line; break; }
    }
    return queued(async () => {
      const changed = await commit(agent, message.slice(0, 100) || `changes by ${agent}`);
      // files outside the code folders that are there now (a deleted one is the agent moving it: no new warning)
      const stray = changed.filter((p) => !CODE.some((c) => p.startsWith(c)) && fs.existsSync(path.join(host.app, p)));
      if (stray.length && host.agents.has(agent))
        host.api.swarm?.send("system", agent, `Your last turn changed files in ${host.app} that aren't your code: ${stray.slice(0, 5).join(", ")}. `
          + `${host.app} is your own code (extensions, skills, ui): it is versioned, and a rollback would undo these files. `
          + `Move project work to ${host.work} and use it from there.`, true);
    });
  });

  host.routes.set("/versions", async (_req: any, res: any) => {
    const now = await head();  // waits for queued work, so the log is complete
    const out = (await git.log(repo)).map(({ oid, commit: c }) => ({ sha: oid, short: oid.slice(0, 7), author: c.author.name,
      date: new Date(c.author.timestamp * 1000).toISOString(), message: c.message.split("\n")[0], current: oid === now,
      shot: fs.existsSync(path.join(SHOTS, `${oid}.png`)) }));  // the page takes the current one's picture if it has none
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  });

  host.routes.set("/versions/", async (req: any, res: any) => {  // /versions/<sha>/shot, /versions/<sha>/rollback
    const [, , given, what] = new URL(req.url, "http://x").pathname.split("/");
    if (!/^[0-9a-f]{7,40}$/.test(given ?? "")) return res.writeHead(400).end();
    let sha: string;
    try { sha = await git.expandOid({ ...repo, oid: given }); } catch { return res.writeHead(404).end(); }
    const shot = path.join(SHOTS, `${sha}.png`);
    if (what === "shot" && (req.method === "GET" || req.method === "HEAD")) {
      if (!fs.existsSync(shot)) return res.writeHead(404).end();
      if (req.method === "HEAD") return res.writeHead(200, { "content-type": "image/png" }).end();
      return fs.createReadStream(shot).pipe(res.writeHead(200, { "content-type": "image/png" }));
    }
    if (what === "shot" && req.method === "PUT") {  // a page's picture of this version
      if (fs.existsSync(shot))  // another page was first: not an error (a 409 would be logged by the browser)
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved: false }));
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_SHOT) chunks.push(c); });
      req.on("end", () => {
        const png = Buffer.concat(chunks);
        if (size > MAX_SHOT || !png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return res.writeHead(400).end();
        fs.mkdirSync(SHOTS, { recursive: true });
        fs.writeFileSync(shot + ".tmp", png);
        fs.renameSync(shot + ".tmp", shot);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved: true }));
      });
      return;
    }
    if (what !== "rollback" || req.method !== "POST") return res.writeHead(404).end();
    const subject = `${sha.slice(0, 7)} ${(await git.readCommit({ ...repo, oid: sha })).commit.message.split("\n")[0]}`;
    await host.api.swarm?.stop();
    const files = await queued(async () => {
      await commit("user", "uncommitted changes before rollback");  // nothing is ever lost
      // that commit's files into app/ and the index, removing files it doesn't have; the branch stays where it is
      await git.checkout({ ...repo, ref: sha, noUpdateHead: true, force: true });
      const files = (await git.statusMatrix(repo)).filter(([, h, w, i]) => !(h === 1 && w === 1 && i === 1)).map(([f]) => f);
      await git.commit({ ...repo, message: `rollback to ${subject}`, author: who("user") });
      return files;
    });
    for (const name of host.agents.keys()) await host.reloadAgent(name);
    if (files.includes("ui/surfaces.json")) { host.shared.get("ui")?.load(); host.api.uiHistory?.add("user", `rolled the code back to ${subject}`); }
    for (const name of host.agents.keys())
      host.api.swarm?.fyi("system", name, `The user rolled ${host.app} back to version ${subject}. Later changes are undone `
        + `(still in the history: GET http://127.0.0.1:3000/versions). Check before relying on them.`);
    const now = await head();
    host.broadcast("version", { agent: "user", sha: now.slice(0, 7), message: `rollback to ${subject}`, files, restart: false });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  });

  host.routes.set("/versions/dom-to-image-more.js", (_req: any, res: any) =>
    res.writeHead(200, { "content-type": "text/javascript" })
      .end(fs.readFileSync(path.join(host.root, "node_modules/dom-to-image-more/dist/dom-to-image-more.min.js"))));
}
