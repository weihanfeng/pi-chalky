// Host: the fixed core under the agents. Everything else, the page included, is a pi extension in
// agent/extensions/<name>/ (agents can change those; this file they can't). This file only:
//   - lays out the four places (agent/, built/, data/, workspace/) and moves an older layout into them once;
//   - runs the web server: its WebSocket /ws, /built/ (what the agents made), and every route extensions add;
//   - keeps one pi AgentSession per agent (session name = agent name; saved under data/sessions/<agent>);
//   - keeps the rule for the version history (host.history) and serves /recover, going back to a working version
//     when an agent broke the page (the safety net);
//   - hands each agent's pi events to the extensions that asked (host.eventHandlers), and tells them when a page
//     opens (host.connectHandlers). The page extension turns pi's messages into the page's and replays them.
// Extensions reach the host through globalThis.chalky (pi loads them with jiti, so they don't share our imports).
// Run: MODEL_BASE_URL=... MODEL_API_KEY=... [MODEL_NAME=...] node server.ts   (Node >= 22.19: it runs the TypeScript as is)
//      CHALKY_LOGIN=off: no /login, /logout, /model on the page; agents always use MODEL_BASE_URL (a cloud deployment)
import fs from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, SessionManager,
  SettingsManager } from "@earendil-works/pi-coding-agent";
import git from "isomorphic-git";
import { WebSocketServer } from "ws";

const ROOT = import.meta.dirname;                         // this package: server.ts and the starting agent/
// HOME: where this Chalky keeps its things. CHALKY_HOME (bin/chalky.mjs, an installed copy: ~/.chalky), else this folder.
// Four places, one job each (the prompt gives them as {agent}, {built}, {data}, {workspace}):
const HOME = process.env.CHALKY_HOME ? path.resolve(process.env.CHALKY_HOME) : ROOT;
const AGENT = path.join(HOME, "agent");                   // what the agents ARE, pi's agentDir: SYSTEM.md, settings, extensions/, skills/
const BUILT = path.join(HOME, "built");                   // what they MADE for the user: card.json, board.json, apps/; served at /built/
const DATA = path.join(HOME, "data");                     // what is kept while running: conversations, typed data, notes (not versioned)
const WORKSPACE = path.join(HOME, "workspace");           // the agents' working folder (bash runs here); workspace/drops: the user's files
// The version history covers agent/ and built/ together (a rollback puts both back), but not the logins and endpoints
// (the model extension writes them, not the agents) or installed packages. Here, so /recover follows it too.
const NOT_IN_HISTORY = ["agent/auth.json", "agent/models.json", "agent/models-store.json", "agent/mcp-auth.json"];
const inHistory = (f: string) => /^(agent|built)\//.test(f) && !NOT_IN_HISTORY.includes(f) && !f.split("/").includes("node_modules");
// What an agent is made of (paths in agent/). A new home starts with these from this package (no logins, nothing
// built); anything else an agent puts in agent/ doesn't belong there (the version extension tells it so).
const AGENT_PARTS = ["extensions/", "skills/", "SYSTEM.md", "mcp.json", "settings.json"];
const isAgentPart = (rel: string) => !rel.split(path.sep).includes("node_modules")
  && AGENT_PARTS.some((p) => (rel.replaceAll(path.sep, "/") + "/").startsWith(p) || rel === p);
const startAgent = () => fs.cpSync(path.join(ROOT, "agent"), AGENT, { recursive: true,
  filter: (src) => { const rel = path.relative(path.join(ROOT, "agent"), src); return !rel || isAgentPart(rel); } });
// our dependencies' folder (npm may put it above this package)
const MODULES = path.resolve(createRequire(import.meta.url).resolve("ws/package.json"), "../..");

// The layout before 2026-11 (app/: the agent and what it built; state/: the data), moved once into the four places.
// An old app/ (an installed home) gives up only the user's things: its code stays as app-before-reorg/, and agent/ is
// this package's (the old code expects the old layout). The old version history stays too: its paths were app/'s.
function migrate() {
  const move = (from: string, to: string) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    console.log(`moved ${path.relative(HOME, from)} -> ${path.relative(HOME, to)}`);
  };
  const old = path.join(HOME, "app");
  if (fs.existsSync(old)) {
    if (!fs.existsSync(AGENT)) startAgent();
    for (const f of [...NOT_IN_HISTORY.map((f) => path.basename(f)), "mcp.json", "settings.json"])  // the user's, not code
      if (fs.existsSync(path.join(old, f))) { fs.rmSync(path.join(AGENT, f), { force: true }); move(path.join(old, f), path.join(AGENT, f)); }
  }
  for (const ui of [path.join(old, "ui"), path.join(AGENT, "ui")]) {  // what they built: app/ui (installed), agent/ui (this repo)
    const apps = path.join(ui, "apps");
    if (fs.existsSync(apps)) for (const name of fs.readdirSync(apps)) if (name !== ".keep") move(path.join(apps, name), path.join(BUILT, "apps", name));
    move(path.join(ui, "surfaces.json"), path.join(BUILT, "card.json"));
    move(path.join(ui, "boards.json"), path.join(BUILT, "board.json"));
    fs.rmSync(path.join(apps, ".keep"), { force: true });
    for (const d of [apps, ui]) try { fs.rmdirSync(d); } catch {}
  }
  if (fs.existsSync(old)) move(old, path.join(HOME, "app-before-reorg"));
  move(path.join(HOME, "state"), DATA);
  for (const [from, to] of [["ui-data.json", "card.json"], ["ui-history.jsonl", "history.jsonl"], ["notes.json", "note.json"],
    ["frames.json", "frame.json"], ["login.json", "model.json"], ["app-data", "app"], ["screens", "screen"], ["pointed", "viewer"],
    ["shots", "version/shots"], ["versions.git", "version-before-reorg.git"]]) move(path.join(DATA, from), path.join(DATA, to));
  // what was in them, in the new words: a card's "components" are its "blocks", each {"block": kind}; the Card block
  // is Panel; a card that was one App block shows that app; the undo steps' "surfaces" are "cards"; apps use the new addresses
  const blocks = (list: any[]) => list.map(({ component, ...b }: any) => ({ ...b, block: component === "Card" ? "Panel" : component }));
  const content = ({ components, ...rest }: any) => components.length === 1 && components[0].component === "App"
    ? { ...rest, app: `apps/${components[0].src}`, ...(components[0].height ? { height: components[0].height } : {}) }
    : { ...rest, blocks: blocks(components) };
  const card = (r: any) => {
    if (!r.components) return r;
    const out: any = content(r);
    if (out.options) out.options = out.options.map((o: any) => o.components ? content(o) : o);
    if (out.kinds) out.kinds = Object.fromEntries(Object.entries(out.kinds).filter(([k]) => k !== "App").map(([k, v]) => [k === "Card" ? "Panel" : k, v]));
    return out;
  };
  const cards = (all: Record<string, any>) => Object.fromEntries(Object.entries(all).map(([id, r]) => [id, card(r)]));
  const rewrite = (file: string, change: (text: string) => string) => {
    const text = fs.readFileSync(file, "utf8"), now = change(text);
    if (now !== text) { fs.writeFileSync(file, now); console.log(`updated ${path.relative(HOME, file)}`); }
  };
  if (fs.existsSync(path.join(BUILT, "card.json"))) rewrite(path.join(BUILT, "card.json"), (t) => t.includes('"components"') ? JSON.stringify(cards(JSON.parse(t)), null, 1) : t);
  if (fs.existsSync(path.join(DATA, "history.jsonl"))) rewrite(path.join(DATA, "history.jsonl"), (t) => !t.includes('"surfaces"') ? t
    : t.split("\n").map((l) => { if (!l) return l; const { surfaces, ...e } = JSON.parse(l); return JSON.stringify(surfaces ? { ...e, cards: cards(surfaces) } : e); }).join("\n"));
  const apps = path.join(BUILT, "apps");
  if (fs.existsSync(apps)) for (const f of fs.readdirSync(apps, { recursive: true }) as string[])
    if (/\.(html|js|mjs)$/.test(f) && !f.split(path.sep).includes("node_modules")) rewrite(path.join(apps, f), (t) => t
      .replaceAll("/ui/agents.js", "/app/agents.js").replaceAll("/ui/voice.js", "/voice/voice.js")
      .replaceAll("/ui-api/app-data/", "/app/data/").replaceAll("/ui/apps/", "/built/apps/"));
}
migrate();
if (!fs.existsSync(AGENT)) startAgent();  // first run: the starting agent
if (HOME !== ROOT) {  // HOME/agent's extensions import our dependencies: Node looks for a node_modules above them
  const link = path.join(HOME, "node_modules");
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);  // again each start: the package may have moved
  if (fs.existsSync(link)) throw new Error(`${link} is in the way: Chalky links it to ${MODULES}`);
  fs.symlinkSync(MODULES, link, "junction");
}
// pi's agent folder for the code that doesn't take our agentDir but calls getAgentDir() (its MCP extension: mcp.json
// and mcp-auth.json): the same agent/
process.env.PI_CODING_AGENT_DIR = AGENT;
const PORT = Number(process.env.PORT || 3000);            // the page's port
for (const d of [path.join(BUILT, "apps"), DATA, WORKSPACE]) fs.mkdirSync(d, { recursive: true });

type Agent = { name: string; role: string; app?: string; session: any; unsubscribe: () => void;
  stopped?: boolean };  // stopped: this run was stopped on purpose (host.abort)

const sockets = new Set<any>();
const host = {
  root: ROOT, home: HOME, agent: AGENT, built: BUILT, data: DATA, workspace: WORKSPACE, modules: MODULES, port: PORT,
  inHistory,                                        // inHistory(path in HOME): whether the version history keeps that file
  isAgentPart,                                      // isAgentPart(path in agent/): whether it is part of an agent
  agents: new Map<string, Agent>(),
  routes: new Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>(),  // path -> handler (a path ending in /: also every path under it)
  pageHandlers: new Map<string, (msg: any) => void>(),  // one per extension (not per agent): key -> handler
  eventHandlers: new Map<string, (agent: string, ev: any) => void>(),  // every pi event of every agent (session.subscribe:
                                                    // also what pi.on misses, e.g. a message filed while idle); key -> handler
  connectHandlers: new Map<string, (send: (type: string, data: object) => void) => void>(),  // a page opened: what it gets first
  shared: new Map<string, any>(),                   // state extensions share across agents (e.g. the cards)
  reloadAfterTurn: new Map<string, boolean>(),      // agents whose extensions load again when their turn ends -> quiet
  api: {} as Record<string, any>,                   // services extensions offer by name (e.g. team); the newest load wins
  file,                                             // file(res, path): send a file (type from its extension; 404 if none)

  broadcast(type: string, data: object) {
    const text = JSON.stringify({ type, ...data });
    for (const s of sockets) s.send(text);
  },

  // Without the team extension: each agent idle or working, and messages go straight to a run
  status() {
    if (host.api.team) return host.api.team.status();
    return Object.fromEntries([...host.agents.values()].map((a) => [a.name, { role: a.role, app: a.app ?? null,
      state: a.session.isStreaming ? "working" : "idle", doing: "", since: 0, queued: 0 }]));
  },
  send(from: string, to: string, text: string) {
    if (host.api.team) return host.api.team.send(from, to, text);
    void host.prompt(to, `[message from ${from} · ${new Date().toTimeString().slice(0, 8)}]\n${text}`, from);
  },

  // One run: the agent answers input. Returns its final answer, or "(error: ...)". Then a reload it asked for.
  // replyTo: who the answer goes to (the page labels it). Saved as a "chalky.turn" entry, which the model doesn't see.
  // images: pictures sent with the input (pi's {type: "image", data: base64, mimeType}), e.g. doodle's steps.
  async prompt(name: string, input: string, replyTo?: string, images?: { type: "image"; data: string; mimeType: string }[]) {
    const a = host.agents.get(name)!;
    if (replyTo) a.session.sessionManager.appendCustomEntry("chalky.turn", { reply_to: replyTo });  // for the user message next
    a.stopped = false;
    try {
      await a.session.prompt(input, images?.length ? { images } : undefined);
      const last = [...a.session.messages].reverse().find((m: any) => m.role === "assistant");
      if (a.stopped) return "(stopped)";  // pi 1.4.0 can record a stop as stopReason "error" ("This operation was aborted")
      if (last?.stopReason === "error") {
        emit("error", { agent: name, text: last.errorMessage });
        return `(error: ${last.errorMessage})`;
      }
      return last ? text(last.content) : "";
    } catch (e) {
      if (a.stopped) return "(stopped)";
      emit("error", { agent: name, text: String(e) });
      return `(error: ${e})`;
    } finally {
      const quiet = host.reloadAfterTurn.get(name);
      if (host.reloadAfterTurn.delete(name)) await host.reloadAgent(name, quiet);
    }
  },

  // Stop an agent's run on purpose (Stop, the step limit): not shown as an error
  async abort(name: string) {
    const a = host.agents.get(name);
    if (!a) return;
    a.stopped = true;
    await a.session.abort();
  },

  // load an agent's extensions, skills and prompt again (pi's reload; the conversation stays). quiet: no
  // "extensions reloaded" note on the page (errors still show)
  async reloadAgent(name: string, quiet = false) {
    const a = host.agents.get(name)!;
    await a.session.reload();
    for (const e of a.session.resourceLoader.getExtensions().errors) emit("error", { agent: name, text: `extension ${e.path}: ${e.error}` });
    if (!quiet) emit("error", { agent: name, text: "extensions reloaded" });  // shown as a note on the page
  },

  // fresh: a new session file (an empty memory); the old files stay, and the page still shows them
  async createAgent(name: string, role: string, app?: string, fresh = false) {
    const old = host.agents.get(name);
    if (old) { old.unsubscribe(); old.session.dispose(); }
    const dir = path.join(DATA, "sessions", name);
    fs.mkdirSync(dir, { recursive: true });
    // pi's settings: app/settings.json (e.g. compaction). projectTrusted false: pi ignores workspace/.pi/ (its
    // SYSTEM.md, extensions, skills, settings), so an agent's project files can't change it; app/ (versioned) is the only place
    const settingsManager = SettingsManager.create(WORKSPACE, AGENT, { projectTrusted: false });
    // agentDir = app/: pi finds app/extensions/<name>/index.ts and app/skills/* itself, again on every reload
    // pi's MCP (the CLI's built-in extensions, which SDK sessions don't load): the servers in agent/mcp.json, with
    // codemode and tool_search for servers whose tools aren't direct. Sign-ins: agent/mcp-auth.json (not versioned).
    const resourceLoader = new DefaultResourceLoader({ cwd: WORKSPACE, agentDir: AGENT, settingsManager, noContextFiles: true,
      extensionFactories: [createCodemodeExtension(), createToolSearchExtension(),
        createMcpExtension({ logPath: path.join(DATA, "mcp.log") })] });
    await resourceLoader.reload();
    for (const e of resourceLoader.getExtensions().errors) console.error(`${name}: extension ${e.path} failed: ${e.error}`);
    const { session } = await createAgentSession({
      cwd: WORKSPACE, agentDir: AGENT, resourceLoader, settingsManager,
      // the saved conversation, or a new one
      sessionManager: fresh ? SessionManager.create(WORKSPACE, dir) : SessionManager.continueRecent(WORKSPACE, dir),
    });
    if (session.sessionName !== name) session.setSessionName(name);
    const empty = session.sessionManager.buildSessionContext().messages.length === 0;
    // starts the extensions' session (session_start). onError, besides showing extensions' errors: pi 1.4.0's reload()
    // sends session_start again only to a session with a binding, and without it pi's MCP doesn't reconnect after a reload
    await session.bindExtensions({ onError: (e) => {
      console.error(`${name}: extension ${e.extensionPath} (${e.event}): ${e.error}`);
      emit("error", { agent: name, text: `extension ${e.extensionPath} (${e.event}): ${e.error}` });
    } });
    // the model: the one picked with /login or /model, else the MODEL_BASE_URL endpoint (both: extensions/model).
    // CHALKY_LOGIN=off (a cloud deployment, the backend's endpoint): always that endpoint, whatever an extension says
    const picked = process.env.CHALKY_LOGIN === "off" ? undefined : host.api.model?.modelFor(name, session);
    const model = picked ?? session.modelRuntime.getModel("chalky", process.env.MODEL_NAME || "default");
    if (model) await session.setModel(model);
    // thinking level: the agent's own (the /thinking command), which pi keeps in its session file; an empty
    // conversation starts at "medium". Set here: pi restores it only when it knows the model then, and ours (the
    // model extension) comes later, so pi would say "off"
    session.setThinkingLevel(empty ? "medium" : session.sessionManager.buildSessionContext().thinkingLevel);
    const a: Agent = { name, role, app, session, unsubscribe: () => {} };
    host.agents.set(name, a);
    a.unsubscribe = session.subscribe((ev: any) => {
      for (const [key, fn] of host.eventHandlers) try { fn(name, ev); } catch (e) { console.error(`event handler ${key}:`, e); }
    });
    fs.writeFileSync(path.join(dir, "role.json"), JSON.stringify({ role, app }));
    host.broadcast("status", { agents: host.status() });
    return a;
  },
};
(globalThis as any).chalky = host;

// An error nothing handled (in an extension's route or timer, say): keep serving, and show it. Without this, one
// mistake in any extension, also one an agent wrote, would stop the whole process (no start.sh here).
process.on("uncaughtException", (e) => {
  console.error("uncaught:", e);
  host.broadcast("error", { agent: "server", text: `uncaught ${e?.name}: ${e?.message}` });
});

const text = (content: any) => typeof content === "string" ? content
  : content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");

const emit = (type: string, data: object) => host.broadcast(type, data);

// ---- web server: /ws, and the routes extensions add ----
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
function file(res: http.ServerResponse, p: string) {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(p).pipe(res);
}

// ---- the version history: one git repo for agent/ and built/ (inHistory), kept in data/version/git ----
// Outside the folders it keeps, so an agent's own git commands can't rewrite it. Git through isomorphic-git (pure JS).
// The version extension commits and rolls back with this; /recover too, so it works when that extension is broken.
//   repo     isomorphic-git's {fs, dir: HOME, gitdir}
//   stage()  git add -A for what inHistory keeps (.gitignore files play no part); returns the changed paths
const REPO = { fs, dir: HOME, gitdir: path.join(DATA, "version", "git") };
const KEPT = { filepaths: ["agent", "built"], ignored: true, filter: inHistory };  // statusMatrix's walk: only these
async function stage() {
  const changed = [];
  for (const [filepath, head, workdir, index] of await git.statusMatrix({ ...REPO, ...KEPT })) {
    if (head === 1 && workdir === 1 && index === 1) continue;  // unchanged
    if (workdir === 0) { if (index !== 0) await git.remove({ ...REPO, filepath }); }
    else await git.add({ ...REPO, filepath, force: true });
    changed.push(filepath);
  }
  return changed;
}
Object.assign(host, { history: { repo: REPO, kept: KEPT, stage } });

// ---- recovery: the safety net for when an agent breaks the page (or the version extension, so its panel) ----
// Here, not in an extension, so agents can't break it too. Plain HTML forms, no script: it works whatever agent/ holds.
//   GET  /recover        the saved versions, newest first; "the page worked" = the page took its picture of that
//                        version (data/version/shots/<sha>.png); the newest too (a broken version extension doesn't
//                        save the edit that broke it)
//   POST /recover/<sha>  that version's agent/ and built/ back, as a new commit (as the version panel's rollback,
//                        without its extras), then every agent's extensions load again; back to the page
// Also shown at / when no extension serves the page (the page extension failed to load).
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function recoverPage(res: http.ServerResponse) {
  // the history's folder comes before its first commit: right after a start there may be no versions yet
  const log = fs.existsSync(REPO.gitdir) ? await git.log(REPO).catch((e) => e.code === "NotFoundError" ? [] : Promise.reject(e)) : [];
  const rows = log.map(({ oid, commit: c }, i) => `<tr><td>${new Date(c.author.timestamp * 1000).toLocaleString()}</td>
    <td>${esc(c.author.name)}</td><td>${esc(c.message.split("\n")[0])}</td>
    <td>${fs.existsSync(path.join(DATA, "version", "shots", `${oid}.png`)) ? "the page worked" : ""}</td>
    <td><form method="post" action="/recover/${oid}"><button>go back to this</button></form>${i ? "" : " (the last saved)"}</td></tr>`);
  const failed = host.agents.get("agent1")?.session.resourceLoader.getExtensions().errors ?? [];  // what didn't load
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Recover</title>
<style>body{font:14px system-ui;margin:2em}td{padding:4px 10px;border-bottom:1px solid #ddd}</style>
<h1>Recover</h1><p>If an agent broke the page, go back to a version where it worked. Nothing is lost: the current
files are saved first, and going back is itself a new version. <a href="/">Back to the page</a></p>
${failed.map((e: any) => `<p style="color:#b00">Failed to load: ${esc(path.relative(AGENT, e.path))}: ${esc(String(e.error))}</p>`).join("")}
<table>${rows.join("") || "<tr><td>No versions yet.</td></tr>"}</table>`);
}

async function recover(sha: string, res: http.ServerResponse) {
  try { sha = await git.expandOid({ ...REPO, oid: sha }); } catch { return res.writeHead(404).end(); }
  await host.shared.get("version")?.queue;  // after the versions extension's own work
  try { await host.api.team?.stop(); } catch {}  // the team extension may be the broken one
  for (const name of host.agents.keys()) await host.abort(name);
  const author = { name: "user", email: "user@chalky" };
  const subject = `${sha.slice(0, 7)} ${(await git.readCommit({ ...REPO, oid: sha })).commit.message.split("\n")[0]}`;
  await stage();
  try { await git.commit({ ...REPO, message: "uncommitted changes before recovery", author, disallowEmpty: true }); } catch {}
  await git.checkout({ ...REPO, ref: sha, noUpdateHead: true, force: true, filepaths: KEPT.filepaths });
  const files = await stage();
  for (const f of files) for (let d = path.dirname(f); !["agent", "built", "."].includes(d); d = path.dirname(d)) {  // folders it emptied
    try { fs.rmdirSync(path.join(HOME, d)); } catch { break; }
  }
  await git.commit({ ...REPO, message: `recover to ${subject}`, author });
  for (const name of host.agents.keys()) await host.reloadAgent(name);
  if (files.includes("built/card.json")) { host.shared.get("card")?.load?.(); host.api.history?.add("user", `recovered to ${subject}`); }
  for (const name of host.agents.keys())
    host.api.team?.fyi("system", name, `The user recovered ${AGENT} and ${BUILT} to version ${subject} (the page was broken). `
      + `Later changes are undone (still in the history: GET http://127.0.0.1:${PORT}/version). Check before relying on them.`);
  console.log(`recovered to ${subject}`);
  res.writeHead(303, { location: "/" }).end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x").pathname;
  if (url === "/recover") return void recoverPage(res);
  if (url.startsWith("/recover/") && req.method === "POST") return void recover(url.slice(9), res);
  if (url.startsWith("/built/")) {  // what the agents made, at the same path as on disk (built/ holds no secrets)
    let p = "";
    try { p = path.join(HOME, path.posix.normalize(decodeURIComponent(url))); } catch {}  // a bad %-escape: 404
    return p.startsWith(BUILT + path.sep) ? file(res, p) : void res.writeHead(404).end();  // also a ".." out of built/
  }
  let route = host.routes.get(url);
  for (let p = url; !route && p.lastIndexOf("/") > 0; route = host.routes.get(p + "/")) p = p.slice(0, p.lastIndexOf("/"));
  if (route) return route(req, res);
  if (url === "/") return void recoverPage(res);  // nothing serves the page: an extension broke
  res.writeHead(404).end();
});

new WebSocketServer({ server, path: "/ws" }).on("connection", (sock) => {
  const send = (type: string, data: object) => sock.send(JSON.stringify({ type, ...data }));
  send("status", { agents: host.status() });
  for (const [key, fn] of host.connectHandlers) try { fn(send); } catch (e) { console.error(`connect handler ${key}:`, e); }
  sockets.add(sock);
  sock.on("close", () => sockets.delete(sock));
  sock.on("message", async (raw) => {
    const data = JSON.parse(String(raw));
    const kind = data.type ?? "chat";
    if (kind === "chat") host.send("user", data.to === "main" || !host.agents.has(data.to) ? "agent1" : data.to, data.text);
    else if (kind === "stop" && host.api.team) await host.api.team.stop();
    else if (kind === "stop") {
      for (const a of host.agents.values()) await host.abort(a.name);
      emit("stopped", { agent: "all" });
    } else for (const fn of host.pageHandlers.values()) await fn(data);
  });
});

// agent1, then every agent saved by an earlier run (their conversations come back from their session files)
await host.createAgent("agent1", "the user's main agent");
for (const name of fs.readdirSync(path.join(DATA, "sessions")).filter((n) => n !== "agent1")) {
  const { role, app } = JSON.parse(fs.readFileSync(path.join(DATA, "sessions", name, "role.json"), "utf8"));
  await host.createAgent(name, role, app);
}
const hostName = process.env.UI_HOST || "127.0.0.1";
server.listen(PORT, hostName, () => console.log(`chalky (pi) on http://${hostName}:${PORT}   (if the page breaks: http://${hostName}:${PORT}/recover)`));
