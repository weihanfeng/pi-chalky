// Host: the fixed core under the agents. Everything else, the page included, is a pi extension in
// app/extensions/<name>/ (agents can change those; this file they can't). This file only:
//   - runs the web server: its WebSocket /ws, and every route extensions add (the page: extensions/page);
//   - keeps one pi AgentSession per agent (session name = agent name; saved under state/sessions/<agent>);
//   - serves /recover: going back to a working version when an agent broke the page (the safety net);
//   - turns pi's messages into the page's (OpenAI chat format); the page replays pi's session files (compaction
//     keeps the original entries, so the page still shows everything).
// Extensions reach the host through globalThis.chalky (pi loads them with jiti, so they don't share our imports).
// Run: MODEL_BASE_URL=... MODEL_API_KEY=... node server.ts   (Node >= 22.19: it runs the TypeScript as is)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import git from "isomorphic-git";
import { WebSocketServer } from "ws";

const ROOT = import.meta.dirname;
const APP = path.join(ROOT, "app");                       // agent-editable, pi's agentDir: extensions/, skills/, ui/ (what they built)
const STATE = path.join(ROOT, "state");                   // conversations and data, not code
const WORK = path.join(ROOT, "workspace");                // the agents' working folder (bash runs here)
for (const d of [STATE, WORK]) fs.mkdirSync(d, { recursive: true });

type Agent = { name: string; role: string; app?: string; session: any; joined?: boolean; unsubscribe: () => void; replyTo?: string;
  stopped?: boolean };  // stopped: this run was stopped on purpose (host.abort)

const sockets = new Set<any>();
const host = {
  root: ROOT, app: APP, state: STATE, work: WORK,
  agents: new Map<string, Agent>(),
  routes: new Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>(),  // path -> handler (a path ending in /: also every path under it)
  pageHandlers: new Map<string, (msg: any) => void>(),  // one per extension (not per agent): key -> handler
  shared: new Map<string, any>(),                   // state extensions share across agents (e.g. the surfaces)
  reloadAfterTurn: new Set<string>(),               // agents whose extensions load again when their turn ends
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
    if (replyTo) {
      a.session.sessionManager.appendCustomEntry("chalky.turn", { reply_to: replyTo });
      a.replyTo = replyTo;  // for the user message this run starts with
    }
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
      if (host.reloadAfterTurn.delete(name)) await host.reloadAgent(name);
    }
  },

  // Stop an agent's run on purpose (Stop, the step limit): not shown as an error
  async abort(name: string) {
    const a = host.agents.get(name);
    if (!a) return;
    a.stopped = true;
    await a.session.abort();
  },

  // load an agent's extensions, skills and prompt again (pi's reload; the conversation stays)
  async reloadAgent(name: string) {
    const a = host.agents.get(name)!;
    await a.session.reload();
    for (const e of a.session.resourceLoader.getExtensions().errors) emit("error", { agent: name, text: `extension ${e.path}: ${e.error}` });
    emit("error", { agent: name, text: "extensions reloaded" });  // shown as a note on the page
  },

  // fresh: a new session file (an empty memory); the old files stay, and the page still shows them
  async createAgent(name: string, role: string, app?: string, fresh = false) {
    const old = host.agents.get(name);
    if (old) { old.unsubscribe(); old.session.dispose(); }
    const dir = path.join(STATE, "sessions", name);
    fs.mkdirSync(dir, { recursive: true });
    const settingsManager = SettingsManager.inMemory();
    // agentDir = app/: pi finds app/extensions/<name>/index.ts and app/skills/* itself, again on every reload
    const resourceLoader = new DefaultResourceLoader({ cwd: WORK, agentDir: APP, settingsManager, noContextFiles: true });
    await resourceLoader.reload();
    for (const e of resourceLoader.getExtensions().errors) console.error(`${name}: extension ${e.path} failed: ${e.error}`);
    const { session } = await createAgentSession({
      cwd: WORK, agentDir: APP, resourceLoader, settingsManager,
      // the saved conversation, or a new one
      sessionManager: fresh ? SessionManager.create(WORK, dir) : SessionManager.continueRecent(WORK, dir),
    });
    if (session.sessionName !== name) session.setSessionName(name);
    await session.bindExtensions({});  // starts the extensions' session (session_start)
    const model = session.modelRuntime.getModel("chalky", process.env.MODEL_NAME || "default");
    if (model) await session.setModel(model);
    const joined = session.sessionManager.getEntries().some((e: any) => e.type === "message" && e.message.role === "system");
    const a: Agent = { name, role, app, session, joined, unsubscribe: () => {} };
    host.agents.set(name, a);
    a.unsubscribe = session.subscribe((ev: any) => onEvent(a, ev));
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

// pi message -> the page's message (OpenAI chat format, as the Python harness stored them).
// first: the agent's first system message, which the page shows as "<agent> joined".
// replyTo: on the message that starts a turn, who its answer goes to (not on items slipped into a running turn).
function toChalky(m: any, first = false, replyTo?: string) {
  const ts = (m.timestamp ?? Date.now()) / 1000;
  if (m.role === "system") return first ? { role: "system", content: "", ts } : null;
  if (m.role === "user" || (m.role === "custom" && m.customType === "inbox")) {  // inbox: swarm items filed without a turn
    return { role: "user", content: text(m.content), ...(replyTo && { reply_to: replyTo }), ts };
  }
  if (m.role === "assistant") {
    const calls = m.content.filter((p: any) => p.type === "toolCall")
      .map((p: any) => ({ id: p.id, type: "function", function: { name: p.name, arguments: JSON.stringify(p.arguments) } }));
    const reasoning = m.content.filter((p: any) => p.type === "thinking").map((p: any) => p.thinking).join("\n");
    return { role: "assistant", content: text(m.content), ...(reasoning && { reasoning }), ...(calls.length && { tool_calls: calls }),
             ...(m.errorMessage && { content: `error: ${m.errorMessage}` }), ts };
  }
  if (m.role === "toolResult")
    return { role: "tool", tool_call_id: m.toolCallId, content: (m.isError ? "error: " : "") + text(m.content), ts };
  return null;  // pi's own kinds (custom, compaction summary, ...): not shown
}

const emit = (type: string, data: object) => host.broadcast(type, data);

// Every message of an agent, from all its session files (older rounds first), in the page's format
function record(a: Agent) {
  const current = a.session.sessionManager.getSessionFile();
  const dir = path.dirname(current);
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().flatMap((f) => {
    const p = path.join(dir, f);
    const entries = p === current ? a.session.sessionManager.getEntries() : SessionManager.open(p, dir).getEntries();
    let joined = false, replyTo: string | undefined;
    return entries.flatMap((e: any) => {
      if (e.type === "custom" && e.customType === "chalky.turn") replyTo = e.data.reply_to;
      const msg = e.type === "message" ? e.message : e.type === "custom_message" ? { ...e, role: "custom", timestamp: Date.parse(e.timestamp) } : null;
      if (!msg) return [];
      const m = toChalky(msg, !joined && msg.role === "system", msg.role === "user" ? replyTo : undefined);
      if (msg.role === "system") joined = true;
      if (msg.role === "user") replyTo = undefined;
      return m ? [{ agent: a.name, ...m }] : [];
    });
  });
}

function onEvent(a: Agent, ev: any) {
  if (ev.type === "message_end") {
    const first = ev.message.role === "system" && !a.joined;
    if (first) a.joined = true;
    const m = toChalky(ev.message, first, ev.message.role === "user" ? a.replyTo : undefined);
    if (ev.message.role === "user") a.replyTo = undefined;
    if (m) emit("message", { agent: a.name, ...m });
  } else if (ev.type === "agent_start") emit("run_start", { agent: a.name });
  else if (ev.type === "agent_settled") emit("run_end", { agent: a.name });
  else if (ev.type === "compaction_end" && ev.result)
    emit("compacted", { agent: a.name, tokens_before: ev.result.tokensBefore, tokens_after: ev.result.estimatedTokensAfter ?? "?" });
}

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
  sock.send(JSON.stringify({ type: "status", agents: host.status() }));
  // replay every agent's record, in time order, so a reload shows everything
  for (const m of [...host.agents.values()].flatMap(record).sort((x: any, y: any) => x.ts - y.ts))
    sock.send(JSON.stringify({ type: "message", ...m }));
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
