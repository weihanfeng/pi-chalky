// Version history of agent/ and built/ together: what the agents are and what they made, so one rollback puts both
// back. The repo and the rule for what it keeps (not logins, endpoints or installed packages) are the host's
// (host.history, server.ts: /recover uses them too); this extension commits, lists and rolls back, one operation at
// a time. Its first commit is both folders as they were the first time, tagged "original" (in an installed home,
// server.ts makes the first one: "Started with Chalky <version>"; it also merges each new release, as a version).
//   - When an agent's turn is over (pi's agent_settled) and either folder changed: commit, author = that agent, message =
//     its reload reason, else what it was asked (Python: what it first said, often just "done"), else what it said.
//     Event "version" to the pages ({agent, sha, message, files, restart: false}: they refresh what changed).
//   - Pictures for the panel: taken by the open page itself (browser.js here, with dom-to-image-more; no
//     headless browser), after each new version and, when a page opens, for the current version if it has none.
//     In data/version/shots/<sha>.png. A version made while no page was open and changed again before one opened: none.
//   - GET  /version                  commits, newest first ({sha, short, author, date, message, current, shot})
//     GET  /version/update          this start's update of Chalky (server.ts's host.update), to the first page that
//                                    asks (browser.js: a notice); later: null. {release, files, conflicts} or {release, error}
//     GET  /version/<sha>/shot      that commit's picture (404 if none; HEAD too)
//     PUT  /version/<sha>/shot      the page's picture (PNG, at most 10 MB; {saved: false} if it has one: the first page wins)
//     POST /version/<sha>/rollback  that commit's files as a NEW commit (history is never rewritten, so a rollback
//                                    can be rolled back). The Python agent restarted its process; here: stop every
//                                    agent, put the files back, reload every agent's extensions (pi's reload), read
//                                    the cards again, and tell each agent (an fyi: no turn).
// Guard: agent/ is the agents themselves. If a commit adds other files there, its agent is told where they belong
// (built/ for what it makes for the user, workspace/ for project work).
import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const { repo, stage, restore } = host.history;
const SHOTS = path.join(host.data, "version", "shots");
const MAX_SHOT = 10 * 1024 * 1024;
const who = (name: string) => ({ name, email: `${name}@chalky` });

const shared = host.shared.get("version") ?? { queue: Promise.resolve(), turnFrom: {} as Record<string, number> };
host.shared.set("version", shared);
function queued<T>(fn: () => Promise<T>): Promise<T> {  // history operations one at a time (agents can finish together)
  const run = shared.queue.then(fn);
  shared.queue = run.catch(() => {});
  return run;
}


// The first time (once per start, though every agent loads this): the history starts with both folders as they are.
// "No commit yet", not "no repo yet": a start stopped between init and the first commit leaves a repo without HEAD.
if (!shared.creating) shared.creating = queued(async () => {
  try { await git.resolveRef({ ...repo, ref: "HEAD" }); return; } catch {}
  await git.init({ ...repo, defaultBranch: "main" });
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
      // files in agent/ that aren't part of an agent, there now (a deleted one is the agent moving it: no new warning)
      const stray = changed.filter((p) => p.startsWith("agent/") && !host.isAgentPart(p.slice("agent/".length)) && fs.existsSync(path.join(host.home, p)));
      if (stray.length && host.agents.has(agent))
        host.api.team?.send("system", agent, `Your last turn added files to ${host.agent} that aren't part of you: ${stray.slice(0, 5).join(", ")}. `
          + `${host.agent} is you (extensions, skills, SYSTEM.md, mcp.json, settings.json). Move what you make for the user to `
          + `${host.built}, and project work to ${host.workspace}.`, true);
    });
  });

  host.routes.set("/version/update", (_req: any, res: any) => {
    const u = host.update && !host.update.told ? host.update : null;
    if (u) u.told = true;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(u));
  });
  host.routes.set("/version", async (_req: any, res: any) => {
    const now = await head();  // waits for queued work, so the log is complete
    const out = (await git.log(repo)).map(({ oid, commit: c }) => ({ sha: oid, short: oid.slice(0, 7), author: c.author.name,
      date: new Date(c.author.timestamp * 1000).toISOString(), message: c.message.split("\n")[0], current: oid === now,
      shot: fs.existsSync(path.join(SHOTS, `${oid}.png`)) }));  // the page takes the current one's picture if it has none
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  });

  host.routes.set("/version/", async (req: any, res: any) => {  // /version/<sha>/shot, /version/<sha>/rollback
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
    await host.api.team?.stop();
    let files: string[];
    try { files = await queued(async () => {
      await commit("user", "uncommitted changes before rollback");  // nothing is ever lost
      await restore(sha);  // that commit's agent/ and built/ (server.ts)
      const files = await stage();
      // git keeps files, not folders: a folder whose files the rollback removed stays, empty (an extension folder
      // without index.ts would show in the map). Remove those, up to the first one that isn't empty.
      for (const f of files) for (let d = path.dirname(f); !["agent", "built", "."].includes(d); d = path.dirname(d)) {
        try { fs.rmdirSync(path.join(host.home, d)); } catch { break; }
      }
      await git.commit({ ...repo, message: `rollback to ${subject}`, author: who("user") });
      return files;
    }); } catch (e: any) {  // an answer, not a request left hanging
      return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    for (const name of host.agents.keys()) await host.reloadAgent(name);
    if (files.includes("built/card.json")) { host.shared.get("card")?.load(); host.api.history?.add("user", `rolled back to ${subject}`); }
    for (const name of host.agents.keys())
      host.api.team?.fyi("system", name, `The user rolled ${host.agent} and ${host.built} back to version ${subject}. Later changes are undone `
        + `(still in the history: GET http://127.0.0.1:${host.port}/version). Check before relying on them.`);
    const now = await head();
    host.broadcast("version", { agent: "user", sha: now.slice(0, 7), message: `rollback to ${subject}`, files, restart: false });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  });

  host.routes.set("/version/dom-to-image-more.js", (_req: any, res: any) =>
    res.writeHead(200, { "content-type": "text/javascript" })
      .end(fs.readFileSync(path.join(host.modules, "dom-to-image-more/dist/dom-to-image-more.min.js"))));
}
