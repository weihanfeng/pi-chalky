// Host: the fixed core under the agents. Everything else, the page included, is a pi extension in
// agent/extensions/<name>/ (agents can change those; this file they can't). This file only:
//   - lays out the four places (agent/, built/, data/, workspace/) and moves an older layout into them once;
//   - runs the web server: its WebSocket /ws, /built/ (what the agents made), and every route extensions add;
//   - keeps one pi AgentSession per agent (session name = agent name; saved under data/sessions/<agent>);
//   - keeps the rule for the version history (host.history) and serves /recover, going back to a working version
//     when an agent broke the page (the safety net);
//   - brings a new release of this package into the home's agent/, merged with what the agents changed (host.update);
//   - hands each agent's pi events to the extensions that asked (host.eventHandlers), and tells them when a page
//     opens (host.connectHandlers). The page extension turns pi's messages into the page's and replays them.
// Extensions reach the host through globalThis.chalky (pi loads them with jiti, so they don't share our imports).
// Run: MODEL_BASE_URL=... MODEL_API_KEY=... [MODEL_NAME=...] node server.ts   (Node >= 22.19: it runs the TypeScript as is)
//      CHALKY_LOGIN=off (hosted): no /login or /logout; /model picks among MODEL_BASE_URL's models (extensions/model)
import fs from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, SessionManager,
  SettingsManager } from "@earendil-works/pi-coding-agent";
import git from "isomorphic-git";
import diff3Merge from "diff3";
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
migrate();  // (a new home's agent/ comes from the update below: the first release, merged into nothing)
if (HOME !== ROOT) {  // HOME/agent's extensions import our dependencies: Node looks for a node_modules above them
  fs.mkdirSync(HOME, { recursive: true });  // a new home: nothing made it yet
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
    // the model: the one picked with /login or /model, else the MODEL_BASE_URL endpoint's MODEL_NAME (both: extensions/model).
    // A pick no longer usable (signed out; hosted: not in the owner's plan any more) is skipped
    const picked = host.api.model?.modelFor(name, session);
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
//   restore(oid)  that version's agent/ and built/ into the folders and the index, removing files it doesn't have
//            (the branch stays where it is; what the history doesn't keep, logins and endpoints, isn't touched)
//   versions()  the user's versions, newest first, as git.log gives them ({oid, commit}): main's own line, without
//            the releases an update merged in (see "updates" below)
const REPO = { fs, dir: HOME, gitdir: path.join(DATA, "version", "git") };
const KEPT = { filepaths: ["agent", "built"], ignored: true, filter: inHistory };  // statusMatrix's walk: only these
// isomorphic-git 1.44.2 takes a file whose size and mtime (whole seconds) match the index as unchanged: a same-size
// change in the second after it was staged would be missed (and an update would write over it). Real git checks
// those "racy" files; here every file that looks unchanged is checked by its content. Its status also misses a change
// of the x bit alone: checked too.
async function stage() {
  const changed = [], staged = new Map<string, string>();  // the index: path -> "oid mode"
  await git.walk({ ...REPO, trees: [git.STAGE()], map: async (f, [e]) => {
    if (e && f !== "." && (await e.type()) === "blob") staged.set(f, `${await e.oid()} ${await e.mode()}`);
    return true;
  } });
  const now = async (f: string) => { const p = path.join(HOME, f);  // the file as git would stage it
    return `${(await git.hashBlob({ object: fs.readFileSync(p) })).oid} ${fs.statSync(p).mode & 0o111 ? 0o100755 : 0o100644}`; };
  for (const [filepath, head, workdir, index] of await git.statusMatrix({ ...REPO, ...KEPT })) {
    if (head === 1 && workdir === 1 && index === 1 && await now(filepath) === staged.get(filepath)) continue;  // unchanged
    if (workdir === 0) { if (index !== 0) await git.remove({ ...REPO, filepath }); }
    else await git.add({ ...REPO, filepath, force: true });
    changed.push(filepath);
  }
  return changed;
}
// Only the folders that either version has files in: for a folder neither has (built/ before anything was made, still
// on disk as built/apps/), isomorphic-git 1.44.2's checkout takes it for a file to delete and throws EISDIR.
async function restore(oid: string) {
  const has = async (ref: string, dir: string) => (await git.listFiles({ ...REPO, ref })).some((f) => f.startsWith(`${dir}/`));
  const head = await git.resolveRef({ ...REPO, ref: "HEAD" });
  const filepaths = [];
  for (const dir of KEPT.filepaths) if (await has(oid, dir) || await has(head, dir)) filepaths.push(dir);
  if (filepaths.length) await git.checkout({ ...REPO, ref: oid, noUpdateHead: true, force: true, filepaths });
}
Object.assign(host, { history: { repo: REPO, kept: KEPT, stage, restore } });

// ---- updates: each release of this package is a commit on the history's "package" branch, merged into main ----
// The package's agent/ is a release; the home's agent/ is what runs, and the agents change it. At start, a release
// not merged yet is committed on "package" (its agent/ only) and merged into main, file by file. The base is the
// release merged last (git's merge base), so for each file:
//   only the release changed it -> the release's        only the home changed it -> the home's
//   both, in different lines -> both changes (diff3)
//   both, in the same lines, or one side deleted it -> the home's stays; the release's goes next to it as
//   <file>.new, and agent1 is asked to merge them (host.update.conflicts)
// First a "Before update" commit of unsaved changes, then one commit with both parents: the version panel undoes an
// update like any change. A new home is the first release merged into nothing; a home from before this has no
// "package" yet: its base is its "original" version (the release it started from). If the update fails, the home
// runs as it was and the page says why (host.update.error). Not when the home is this folder (node server.ts here).
// agent/mcp.json is the user's own list of MCP servers: the package never ships it, so no release brings or removes it.
const RELEASE = `Chalky ${JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version}`;
const CHALKY = { name: "chalky", email: "chalky@chalky" };
const OWN = ["agent/mcp.json"];
const ref = (r: string) => git.resolveRef({ ...REPO, ref: r }).catch(() => undefined);
const blob = async (oid: string) => Buffer.from((await git.readBlob({ ...REPO, oid })).blob);

// The user's versions: from HEAD by first parents only (an update's first parent is the version before it; its
// second, the release), stopping at a release (a new home's first version comes after one). Not git.log: it walks
// both parents, so the releases would be listed as versions (going back to one would take the agents' changes and
// built/ away), the first release twice, and versions made in the same second out of order.
async function versions() {
  const releases = new Set<string>(), original = await ref("refs/tags/original");  // a home from before: its "original" isn't one
  for (let oid = await ref("package"); oid && oid !== original; oid = (await git.readCommit({ ...REPO, oid })).commit.parent[0])
    releases.add(oid);
  const out = [];
  for (let oid = await ref("HEAD"); oid && !releases.has(oid); ) {
    const c = await git.readCommit({ ...REPO, oid });
    out.push(c);
    oid = c.commit.parent[0];
  }
  return out;
}
Object.assign(host.history, { versions });

async function releaseTree(dir: string): Promise<string | null> {  // the package's agent/ (what startAgent copies) as a git tree
  const tree = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(path.join(ROOT, "agent"), p);
    if (!isAgentPart(rel) || OWN.includes(`agent/${rel}`)) continue;
    if (e.isFile()) tree.push({ mode: fs.statSync(p).mode & 0o111 ? "100755" : "100644", path: e.name, type: "blob" as const,
      oid: await git.writeBlob({ ...REPO, blob: fs.readFileSync(p) }) });
    else if (e.isDirectory()) { const oid = await releaseTree(p); if (oid) tree.push({ mode: "040000", path: e.name, type: "tree" as const, oid }); }
  }
  return tree.length ? git.writeTree({ ...REPO, tree }) : null;
}

async function filesOf(commit?: string) {  // agent/'s files in a commit: path -> {oid, mode}
  const files = new Map<string, { oid: string; mode: number }>();
  if (commit) await git.walk({ ...REPO, trees: [git.TREE({ ref: commit })], map: async (p, [e]) => {
    if (p !== "." && p !== "agent" && !p.startsWith("agent/")) return null;  // built/: not the release's
    if (e && (await e.type()) === "blob") files.set(p, { oid: await e.oid(), mode: await e.mode() });
    return true;
  } });
  return files;
}

function merge3(base: Buffer, ours: Buffer, theirs: Buffer) {  // both changes, or null if they touch the same lines
  if ([base, ours, theirs].some((b) => b.includes(0))) return null;  // not text
  const lines = (b: Buffer) => b.toString("utf8").match(/^.*(\r?\n|$)/gm) ?? [];
  const parts = diff3Merge(lines(ours), lines(base), lines(theirs));
  return parts.some((p: any) => p.conflict) ? null : parts.flatMap((p: any) => p.ok).join("");
}

async function update() {
  let main = await ref("main"), pkg = await ref("package");
  const last = pkg && (await git.readCommit({ ...REPO, oid: pkg })).commit.message.trim();
  if (last === RELEASE && main && (await git.findMergeBase({ ...REPO, oids: [main, pkg!] }))[0] === pkg) return;  // merged
  await git.init({ ...REPO, defaultBranch: "main" });  // (does nothing if there is one)
  if ((await stage()).length) main = await git.commit({ ...REPO, message: `Before update to ${RELEASE}`, author: CHALKY });
  if (last !== RELEASE) {
    const agent = await releaseTree(path.join(ROOT, "agent"));
    const tree = await git.writeTree({ ...REPO, tree: agent ? [{ mode: "040000", path: "agent", type: "tree", oid: agent }] : [] });
    const parent = pkg ?? (main && await ref("refs/tags/original"));  // a home from before this: the release it started from
    pkg = await git.commit({ ...REPO, ref: "refs/heads/package", tree, parent: parent ? [parent] : [], message: RELEASE, author: CHALKY });
  }
  const [base] = main ? await git.findMergeBase({ ...REPO, oids: [main, pkg!] }) : [];
  const [B, O, T] = await Promise.all([base, main, pkg].map(filesOf));
  const writes: [string, Buffer | null, number?][] = [], conflicts: string[] = [];  // [path in HOME, content (null: delete), mode]
  for (const f of new Set([...O.keys(), ...T.keys()])) {
    if (OWN.includes(f)) continue;
    const [b, o, t] = [B.get(f), O.get(f), T.get(f)], same = (x?: typeof b, y?: typeof b) => x?.oid === y?.oid && x?.mode === y?.mode;
    if (same(o, t) || same(b, t)) continue;                     // the same, or the release didn't change it: the home's
    if (same(b, o)) { writes.push([f, t ? await blob(t.oid) : null, t?.mode]); continue; }  // only the release changed it
    const merged = b && o && t && merge3(await blob(b.oid), await blob(o.oid), await blob(t.oid));  // (and the x bit: whose changed)
    if (merged != null) { writes.push([f, Buffer.from(merged), b!.mode === t!.mode ? o!.mode : t!.mode]); continue; }
    if (t) writes.push([`${f}.new`, await blob(t.oid), t.mode]);
    conflicts.push(!o ? `${f}: you had deleted it; this release changed it (its version: ${f}.new)`
      : !t ? `${f}: this release removed it; you had changed it (yours is kept)`
      : `${f}: you and this release changed the same lines (its version: ${f}.new)`);
  }
  try {  // (then saved: main moves only when every file is written)
    for (const [f, content, mode] of writes) {
      const p = path.join(HOME, f);
      if (!content) {  // and the folders that leaves empty
        fs.rmSync(p, { force: true });
        for (let d = path.dirname(p); d !== AGENT && fs.existsSync(d) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
        continue;
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      if (mode) fs.chmodSync(p, mode & 0o777);
    }
    await stage();
    await git.commit({ ...REPO, message: main ? `Updated to ${RELEASE}` : `Started with ${RELEASE}`, author: CHALKY,
      parent: main ? [main, pkg!] : [pkg!] });
  } catch (e) {  // each file written goes back as main has it (contents and x bit), or away (.new files too)
    for (const [f] of writes) {
      const p = path.join(HOME, f), o = O.get(f);
      try {
        if (!o) { fs.rmSync(p, { force: true }); continue; }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, await blob(o.oid));
        fs.chmodSync(p, o.mode & 0o777);
      } catch (e2) { console.error(`could not put ${f} back:`, e2); }
    }
    throw e;
  }
  const files = writes.length - writes.filter(([f]) => f.endsWith(".new")).length;
  if (main) return { release: RELEASE, files, conflicts };  // (a new home: nothing to tell)
}

if (HOME !== ROOT) try { Object.assign(host, { update: await update() }); } catch (e: any) {  // run as it was: main didn't move
  console.error(`update to ${RELEASE} failed:`, e);
  const main = await ref("main");
  if (main) await restore(main).catch((e) => console.error("could not put agent/ and built/ back as main has them:", e));  // and the index
  Object.assign(host, { update: { release: RELEASE, error: String(e?.message ?? e) } });
}

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
  const log = await versions();  // (none yet: [])
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
  await restore(sha);
  const files = await stage();
  for (const f of files) for (let d = path.dirname(f); !["agent", "built", "."].includes(d); d = path.dirname(d)) {  // folders it emptied
    try { fs.rmdirSync(path.join(HOME, d)); } catch { break; }
  }
  await git.commit({ ...REPO, message: `recover to ${subject}`, author });
  for (const name of host.agents.keys()) await host.reloadAgent(name);
  if (files.includes("built/card.json")) { host.shared.get("card")?.load?.(); host.api.history?.add("user", `recovered to ${subject}`); }
  for (const name of host.agents.keys())
    host.api.team?.fyi("system", name, `The user recovered ${AGENT} and ${BUILT} to version ${subject} (the page was broken). `
      + `Later changes are undone (still in the history: GET http://127.0.0.1:${PORT}/versions). Check before relying on them.`);
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
const conflicts: string[] = (host as any).update?.conflicts ?? [];  // the update's files to merge: agent1's task
if (conflicts.length) host.send("chalky", "agent1", `Chalky was updated to ${(host as any).update.release}. These files `
  + `were changed both by you (or another agent) and by the update, so yours were kept:\n${conflicts.map((c) => `- ${c}`).join("\n")}\n`
  + "For each, read both versions and make one that keeps what the user had and adds what the update brings, then "
  + "delete the .new file. If you can't tell what the user would want, keep theirs and tell them what the update had.");
for (const name of fs.readdirSync(path.join(DATA, "sessions")).filter((n) => n !== "agent1")) {
  const { role, app } = JSON.parse(fs.readFileSync(path.join(DATA, "sessions", name, "role.json"), "utf8"));
  await host.createAgent(name, role, app);
}
const hostName = process.env.UI_HOST || "127.0.0.1";
server.listen(PORT, hostName, () => console.log(`chalky (pi) on http://${hostName}:${PORT}   (if the page breaks: http://${hostName}:${PORT}/recover)`));
