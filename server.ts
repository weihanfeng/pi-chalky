// Host: the fixed core under the agents. Everything else, the page included, is a pi extension in
// app/extensions/<name>/ (agents can change those; this file they can't). This file only:
//   - runs the web server: its WebSocket /ws, and every route extensions add (the page: extensions/page);
//   - keeps one pi AgentSession per agent (session name = agent name; saved under state/sessions/<agent>);
//   - serves /recover: going back to a working version when an agent broke the page (the safety net);
//   - hands each agent's pi events to the extensions that asked (host.eventHandlers), and tells them when a page
//     opens (host.connectHandlers). The page extension turns pi's messages into the page's and replays them.
// Extensions reach the host through globalThis.chalky (pi loads them with jiti, so they don't share our imports).
// Run: MODEL_BASE_URL=... MODEL_API_KEY=... [MODEL_NAME=...] [MODEL_THINKING=...] node server.ts   (Node >= 22.19: it runs the TypeScript as is)
import fs from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, SessionManager,
  SettingsManager } from "@earendil-works/pi-coding-agent";
import git from "isomorphic-git";
import { WebSocketServer } from "ws";

const ROOT = import.meta.dirname;                         // this package: server.ts and the starting app/
// HOME: where this Chalky keeps its things. CHALKY_HOME (bin/chalky.mjs, an installed copy: ~/.chalky), else this folder
const HOME = process.env.CHALKY_HOME ? path.resolve(process.env.CHALKY_HOME) : ROOT;
const APP = path.join(HOME, "app");                       // agent-editable, pi's agentDir: extensions/, skills/, ui/ (what they built)
const STATE = path.join(HOME, "state");                   // conversations and data, not code
// our dependencies' folder (npm may put it above this package)
const MODULES = path.resolve(createRequire(import.meta.url).resolve("ws/package.json"), "../..");
if (!fs.existsSync(APP)) fs.cpSync(path.join(ROOT, "app"), APP, { recursive: true });  // first run: the starting code
if (HOME !== ROOT) {  // HOME/app's extensions import our dependencies: Node looks for a node_modules above them
  const link = path.join(HOME, "node_modules");
  if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);  // again each start: the package may have moved
  if (fs.existsSync(link)) throw new Error(`${link} is in the way: Chalky links it to ${MODULES}`);
  fs.symlinkSync(MODULES, link, "junction");
}
// pi's agent folder for the code that doesn't take our agentDir but calls getAgentDir() (its MCP extension: mcp.json
// and mcp-auth.json): the same app/
process.env.PI_CODING_AGENT_DIR = APP;
const WORK = path.join(HOME, "workspace");                // the agents' working folder (bash runs here)
for (const d of [STATE, WORK]) fs.mkdirSync(d, { recursive: true });

type Agent = { name: string; role: string; app?: string; session: any; unsubscribe: () => void;
  stopped?: boolean };  // stopped: this run was stopped on purpose (host.abort)

const sockets = new Set<any>();
const host = {
  root: ROOT, app: APP, state: STATE, work: WORK, modules: MODULES,
  agents: new Map<string, Agent>(),
  routes: new Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>(),  // path -> handler (a path ending in /: also every path under it)
  pageHandlers: new Map<string, (msg: any) => void>(),  // one per extension (not per agent): key -> handler
  eventHandlers: new Map<string, (agent: string, ev: any) => void>(),  // every pi event of every agent (session.subscribe:
                                                    // also what pi.on misses, e.g. a message filed while idle); key -> handler
  connectHandlers: new Map<string, (send: (type: string, data: object) => void) => void>(),  // a page opened: what it gets first
  shared: new Map<string, any>(),                   // state extensions share across agents (e.g. the surfaces)
  reloadAfterTurn: new Map<string, boolean>(),      // agents whose extensions load again when their turn ends -> quiet
  api: {} as Record<string, any>,                   // services extensions offer by name (e.g. swarm); the newest load wins
  file,                                             // file(res, path): send a file (type from its extension; 404 if none)

  broadcast(type: string, data: object) {
    const text = JSON.stringify({ type, ...data });
    for (const s of sockets) s.send(text);
  },

  // Without the swarm extension: each agent idle or working, and messages go straight to a run
  status() {
    if (host.api.swarm) return host.api.swarm.status();
    return Object.fromEntries([...host.agents.values()].map((a) => [a.name, { role: a.role, app: a.app ?? null,
      state: a.session.isStreaming ? "working" : "idle", doing: "", since: 0, queued: 0 }]));
  },
  send(from: string, to: string, text: string) {
    if (host.api.swarm) return host.api.swarm.send(from, to, text);
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
    const dir = path.join(STATE, "sessions", name);
    fs.mkdirSync(dir, { recursive: true });
    // projectTrusted false: pi ignores workspace/.pi/ (its SYSTEM.md, extensions, skills, settings), so an agent's
    // project files can't change it; app/ (versioned) is the only place
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
    // agentDir = app/: pi finds app/extensions/<name>/index.ts and app/skills/* itself, again on every reload
    // pi's MCP (the CLI's built-in extensions, which SDK sessions don't load): the servers in app/mcp.json, with
    // codemode and tool_search for servers whose tools aren't direct. Sign-ins: app/mcp-auth.json (not versioned).
    const resourceLoader = new DefaultResourceLoader({ cwd: WORK, agentDir: APP, settingsManager, noContextFiles: true,
      extensionFactories: [createCodemodeExtension(), createToolSearchExtension(),
        createMcpExtension({ logPath: path.join(STATE, "mcp.log") })] });
    await resourceLoader.reload();
    for (const e of resourceLoader.getExtensions().errors) console.error(`${name}: extension ${e.path} failed: ${e.error}`);
    const { session } = await createAgentSession({
      cwd: WORK, agentDir: APP, resourceLoader, settingsManager,
      // the saved conversation, or a new one
      sessionManager: fresh ? SessionManager.create(WORK, dir) : SessionManager.continueRecent(WORK, dir),
    });
    if (session.sessionName !== name) session.setSessionName(name);
    // starts the extensions' session (session_start). onError, besides showing extensions' errors: pi 1.4.0's reload()
    // sends session_start again only to a session with a binding, and without it pi's MCP doesn't reconnect after a reload
    await session.bindExtensions({ onError: (e) => {
      console.error(`${name}: extension ${e.extensionPath} (${e.event}): ${e.error}`);
      emit("error", { agent: name, text: `extension ${e.extensionPath} (${e.event}): ${e.error}` });
    } });
    const model = session.modelRuntime.getModel("chalky", process.env.MODEL_NAME || "default");
    if (model) await session.setModel(model);
    // MODEL_THINKING: pi's thinking level (minimal, low, medium, high, ...), sent as reasoning_effort. Unset: none is
    // sent and the model uses its own default (pi then says "off", but the model may still think).
    if (process.env.MODEL_THINKING) session.setThinkingLevel(process.env.MODEL_THINKING);
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

// ---- recovery: the safety net for when an agent breaks the page (or the versions extension, so its panel) ----
// Here, not in an extension, so agents can't break it too. Plain HTML forms, no script: it works whatever app/ holds.
//   GET  /recover        the saved versions (state/versions.git, written by the versions extension), newest first;
//                        "the page worked" = the page took its picture of that version (state/shots/<sha>.png);
//                        the newest too (a broken versions extension doesn't save the edit that broke it)
//   POST /recover/<sha>  that version's files back into app/, as a new commit (as the versions panel's rollback,
//                        without its extras), then every agent's extensions load again; back to the page
// Also shown at / when no extension serves the page (the page extension failed to load).
const REPO = { fs, dir: APP, gitdir: path.join(STATE, "versions.git") };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function recoverPage(res: http.ServerResponse) {
  const log = fs.existsSync(REPO.gitdir) ? await git.log(REPO) : [];
  const rows = log.map(({ oid, commit: c }, i) => `<tr><td>${new Date(c.author.timestamp * 1000).toLocaleString()}</td>
    <td>${esc(c.author.name)}</td><td>${esc(c.message.split("\n")[0])}</td>
    <td>${fs.existsSync(path.join(STATE, "shots", `${oid}.png`)) ? "the page worked" : ""}</td>
    <td><form method="post" action="/recover/${oid}"><button>go back to this</button></form>${i ? "" : " (the last saved)"}</td></tr>`);
  const failed = host.agents.get("agent1")?.session.resourceLoader.getExtensions().errors ?? [];  // what didn't load
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Recover</title>
<style>body{font:14px system-ui;margin:2em}td{padding:4px 10px;border-bottom:1px solid #ddd}</style>
<h1>Recover</h1><p>If an agent broke the page, go back to a version where it worked. Nothing is lost: the current
files are saved first, and going back is itself a new version. <a href="/">Back to the page</a></p>
${failed.map((e: any) => `<p style="color:#b00">Failed to load: ${esc(path.relative(APP, e.path))}: ${esc(String(e.error))}</p>`).join("")}
<table>${rows.join("") || "<tr><td>No versions yet.</td></tr>"}</table>`);
}

async function recover(sha: string, res: http.ServerResponse) {
  try { sha = await git.expandOid({ ...REPO, oid: sha }); } catch { return res.writeHead(404).end(); }
  await host.shared.get("versions")?.queue;  // after the versions extension's own work
  try { await host.api.swarm?.stop(); } catch {}  // the swarm extension may be the broken one
  for (const name of host.agents.keys()) await host.abort(name);
  const stage = async () => {  // git add -A (new ignored files skipped: statusMatrix misses info/exclude, see versions)
    for (const [f, h, w, i] of await git.statusMatrix(REPO)) {
      if ((h === 1 && w === 1 && i === 1) || (h === 0 && i === 0 && await git.isIgnored({ ...REPO, filepath: f }))) continue;
      if (w === 0) { if (i !== 0) await git.remove({ ...REPO, filepath: f }); } else await git.add({ ...REPO, filepath: f });
    }
  };
  const author = { name: "user", email: "user@chalky" };
  const subject = `${sha.slice(0, 7)} ${(await git.readCommit({ ...REPO, oid: sha })).commit.message.split("\n")[0]}`;
  await stage();
  try { await git.commit({ ...REPO, message: "uncommitted changes before recovery", author, disallowEmpty: true }); } catch {}
  await git.checkout({ ...REPO, ref: sha, noUpdateHead: true, force: true });
  const files = (await git.statusMatrix(REPO)).filter(([, h, w, i]) => !(h === 1 && w === 1 && i === 1)).map(([f]) => f);
  for (const f of files) for (let d = path.dirname(f); d !== "."; d = path.dirname(d)) {  // folders it emptied
    try { fs.rmdirSync(path.join(APP, d)); } catch { break; }
  }
  await git.commit({ ...REPO, message: `recover to ${subject}`, author });
  for (const name of host.agents.keys()) await host.reloadAgent(name);
  if (files.includes("ui/surfaces.json")) host.shared.get("ui")?.load?.();
  for (const name of host.agents.keys())
    host.api.swarm?.fyi("system", name, `The user recovered ${APP} to version ${subject} (the page was broken). `
      + `Later changes are undone (still in the history: GET http://127.0.0.1:3000/versions). Check before relying on them.`);
  console.log(`recovered to ${subject}`);
  res.writeHead(303, { location: "/" }).end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x").pathname;
  if (url === "/recover") return void recoverPage(res);
  if (url.startsWith("/recover/") && req.method === "POST") return void recover(url.slice(9), res);
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
    else if (kind === "stop" && host.api.swarm) await host.api.swarm.stop();
    else if (kind === "stop") {
      for (const a of host.agents.values()) await host.abort(a.name);
      emit("stopped", { agent: "all" });
    } else for (const fn of host.pageHandlers.values()) await fn(data);
  });
});

// agent1, then every agent saved by an earlier run (their conversations come back from their session files)
await host.createAgent("agent1", "the user's main agent");
for (const name of fs.readdirSync(path.join(STATE, "sessions")).filter((n) => n !== "agent1")) {
  const { role, app } = JSON.parse(fs.readFileSync(path.join(STATE, "sessions", name, "role.json"), "utf8"));
  await host.createAgent(name, role, app);
}
const hostName = process.env.UI_HOST || "127.0.0.1";
server.listen(3000, hostName, () => console.log(`chalky (pi) on http://${hostName}:3000   (if the page breaks: http://${hostName}:3000/recover)`));
