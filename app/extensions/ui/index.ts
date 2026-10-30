// UI surfaces from the page's components (port of the Python ui plugin; browser.js, the page side, is its ui.js).
// Tools ui_catalog, ui_render, ui_update, ui_delete; guide.md, a short prompt section (README.md, copied from ui.py: the whole of it).
// The surfaces are shared by every agent: one Surfaces object on the host, made by whichever agent loads first.
// One door: every change goes through change(): it saves, tells every open page, and calls every watcher with the
// surface, who did it and the words for it ("you moved s1"; none: part of a bigger change). restore() puts back a
// saved state (not a change: no watchers). Watchers (Python: the "ui_changed" event), registered from session_start:
//   host.api.ui.watch(name, fn(surface, by, what))   name: the extension's, so its reload replaces its own
// (ui_history: a step per change with words; frames: a frame is done when its surface appears).
//   app/ui/surfaces.json  design (everything but data)      state/ui-data.json  data (what users typed)
// In this folder: components/*.js (the catalog), agents.js and voice.js (what apps import), package.json and
// node_modules/ (browser libraries components import), skills/ (ui-design, ui-check, agent-apps: given to pi).
//   GET /ui/apps/<name>/...  an app (app/ui/apps: what the agents built)
//   GET /ui/components/..., /ui/agents.js, /ui/voice.js  from this folder; /ui/node_modules/{marked,dompurify}/...  the host's
//   GET /ui-api/catalog (name -> mtime), /ui-api/about (name -> about block), /ui-api/surfaces
// App messages and app_reset: swarm/.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const DESIGN = path.join(host.app, "ui/surfaces.json");
const APPS = path.join(host.app, "ui/apps");
const COMPONENTS = path.join(import.meta.dirname, "components");
const SERVED = ["components/", "agents.js", "voice.js"];  // what /ui/ serves from this folder
const LIBS = ["marked/", "dompurify/"];  // the page's browser libraries, from the host's node_modules (its package.json)
const DATA = path.join(host.state, "ui-data.json");
const read = (p: string, d: any) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const clone = (v: any) => structuredClone(v);
const isRef = (v: any) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "path,ref";
const propsOf = (c: any) => Object.fromEntries(Object.entries(c).filter(([k]) => !["id", "component", "children", "child"].includes(k)));

function getPath(data: any, p: string) {
  for (const k of p.split("/").filter(Boolean)) data = data?.[Array.isArray(data) ? Number(k) : k];
  return data;
}
function setPath(data: any, p: string, value: any) {
  const keys = p.split("/").filter(Boolean);
  for (const k of keys.slice(0, -1)) data = data[k] ??= {};
  data[keys.at(-1)!] = value;
}

// On the host, so they outlive this file's reloads; one per watching extension
const watchers: Map<string, (sid: string, by?: string, what?: string) => void> = host.shared.get("ui-watchers") ?? new Map();
host.shared.set("ui-watchers", watchers);
host.api.ui = { watch: (name: string, fn: (sid: string, by?: string, what?: string) => void) => watchers.set(name, fn) };

class Surfaces {
  surfaces: Record<string, any> = read(DESIGN, {});
  constructor() {
    const data = read(DATA, {});
    for (const [sid, r] of Object.entries(this.surfaces)) r.data = data[sid] ?? {};
  }
  save() {
    fs.writeFileSync(DESIGN, JSON.stringify(Object.fromEntries(Object.entries(this.surfaces)
      .map(([sid, r]) => [sid, { ...r, data: undefined }])), null, 1));
    fs.writeFileSync(DATA, JSON.stringify(Object.fromEntries(Object.entries(this.surfaces).map(([sid, r]) => [sid, r.data ?? {}]))));
  }
  get(sid: string) { return clone(this.surfaces[sid]); }
  snapshot() { return clone(this.surfaces); }
  // record null: delete. by: "user" or an agent; what: the history's words for it (none: part of a bigger change,
  // so no step of its own; the last change makes one)
  change(sid: string, record: any, by?: string, what?: string) {
    if (record === null) delete this.surfaces[sid];
    else this.surfaces[sid] = record;
    this.save();
    host.broadcast("ui", record === null ? { op: "delete", surface: sid } : { op: "render", surface: sid, ...record });
    for (const [name, fn] of watchers) {
      try { fn(sid, by, what); }
      catch (e) { host.broadcast("error", { agent: "server", text: `ui watcher ${name}: ${e}` }); }  // one broken watcher doesn't stop the rest
    }
  }
  load() {  // read the files again (after a rollback of the code changed surfaces.json); true if the surfaces changed
    const before = JSON.stringify(this.surfaces), design = read(DESIGN, {}), data = read(DATA, {});
    for (const [sid, r] of Object.entries(design) as any) r.data = data[sid] ?? {};
    this.surfaces = design;
    host.broadcast("ui", { op: "reset", surfaces: this.surfaces });
    return JSON.stringify(this.surfaces) !== before;
  }
  restore(surfaces: Record<string, any>) {  // a whole saved state (undo, redo, rewind): not a change of its own
    this.surfaces = clone(surfaces);
    this.save();
    host.broadcast("ui", { op: "reset", surfaces: this.surfaces });
  }
  locked(sid: string) {
    return this.surfaces[sid]?.pinned ? `error: surface '${sid}' is pinned by the user, so agents can't change or delete it. `
      + `Make a new surface instead (made_from=['${sid}'] keeps the link), or ask the user to unpin it.` : null;
  }
  copyIntoUsers(sid: string) {  // before sid goes: surfaces reading from it get its current values
    const users = Object.keys(this.surfaces).filter((o) => o !== sid && this.surfaces[o].components
      .some((c: any) => Object.values(propsOf(c)).some((v: any) => isRef(v) && v.ref === sid)));
    for (const o of users) {
      const r = this.get(o);
      for (const c of r.components)
        for (const [k, v] of Object.entries(propsOf(c)) as any)
          if (isRef(v) && v.ref === sid) c[k] = clone(getPath(this.surfaces[sid].data, v.path));
      this.change(o, r);
    }
    return users;
  }
}

if (!host.shared.has("ui")) host.shared.set("ui", new Surfaces());
const ui: Surfaces = host.shared.get("ui");

function problems(components: any[], madeFrom: string[] = []) {
  const catalog = readCatalog(), ids = new Set(components.map((c) => c.id));
  const errors = ids.has("root") ? [] : ['one component must have "id": "root"'];
  for (const c of components) {
    if (!(c.component in catalog)) { errors.push(`${c.id}: unknown component '${c.component}' (have: ${Object.keys(catalog).join(", ")})`); continue; }
    for (const child of [...(c.children ?? []), ...(c.child ? [c.child] : [])])
      if (!ids.has(child)) errors.push(`${c.id}: child '${child}' is not defined`);
    const known = catalog[c.component].about?.props;
    for (const [k, v] of Object.entries(propsOf(c)) as any) {
      if (known && !(k in known)) errors.push(`${c.id}: ${c.component} has no prop '${k}' (props: ${Object.keys(known).join(", ") || "none"})`);
      if (isRef(v) && !(v.ref in ui.surfaces)) errors.push(`${c.id}.${k}: refers to surface '${v.ref}', which does not exist`);
    }
  }
  return [...errors, ...madeFrom.filter((m) => !(m in ui.surfaces)).map((m) => `made_from: no surface '${m}'`)];
}

// The components (components/*.js): {name: {doc, mtime, about, problem}}; doc = the comment lines at the top
function readCatalog() {
  const out: Record<string, any> = {};
  for (const f of fs.readdirSync(COMPONENTS).filter((f) => f.endsWith(".js")).sort()) {
    const text = fs.readFileSync(path.join(COMPONENTS, f), "utf8");
    const doc: string[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith("//")) break;
      doc.push(line.slice(2).trim());
    }
    let about = null, problem = null;
    const i = text.indexOf("export const about = ");
    if (i >= 0) {
      try { about = JSON.parse(text.slice(i + 21, text.indexOf("};", i) + 1)); }
      catch (e) { problem = `its about block is not valid JSON (${e})`; }
    }
    out[f.slice(0, -3)] = { doc: doc.join("\n"), mtime: Math.floor(fs.statSync(path.join(COMPONENTS, f)).mtimeMs / 1000), about, problem };
  }
  return out;
}

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const Place = Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Optional(Type.Number()), height: Type.Optional(Type.Number()) },
  { description: "pin it at a spot (px from the main space's top-left); leave out to stack it" }));

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "guide.md"), "utf8")  // short; README.md: the whole of it, read when it says
    .replace("README.md", path.join(import.meta.dirname, "README.md"));
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.ui = guide; });
  pi.on("resources_discover", () => ({ skillPaths: [path.join(import.meta.dirname, "skills")] }));

  pi.registerTool({
    name: "ui_catalog", label: "UI catalog", description: "List the UI components you can use in surfaces, with their props.",
    parameters: Type.Object({}),
    async execute() {
      const catalog = readCatalog();
      const broken = Object.entries(catalog).filter(([, m]: any) => m.problem).map(([n, m]: any) => `${n}: ${m.problem}`);
      return result(Object.values(catalog).map((m: any) => m.doc + (m.about ? `\nabout: ${JSON.stringify(m.about)}` : "")).join("\n\n")
        + (broken.length ? `\n\nProblems:\n${broken.join("\n")}` : ""));
    },
  });

  pi.registerTool({
    name: "ui_render", label: "UI render", description: "Draw or replace a UI surface (a card in the main space) from catalog components.",
    parameters: Type.Object({
      surface: Type.String(),
      components: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
      data: Type.Optional(Type.Record(Type.String(), Type.Any())),
      place: Place,
      draggable: Type.Optional(Type.Boolean()), resizable: Type.Optional(Type.Boolean()),
      about: Type.Optional(Type.String({ description: "what it is for and why it is built this way (its back side)" })),
      options: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: 'alternatives instead of components: [{"label", "components", "data"}]' })),
      made_from: Type.Optional(Type.Array(Type.String())), instruction: Type.Optional(Type.String()),
      board: Type.Optional(Type.Union([Type.Number(), Type.Literal("new")], { description:
        'a board number, or "new" for a new board; leave out: where the surface is, else the board the user is on' })),
    }),
    async execute(_id, a) {
      const agent = pi.getSessionName() ?? "agent";
      const locked = ui.locked(a.surface);
      if (locked) return result(locked);
      if (!a.components && !a.options) return result("error: give components, or options (a list of alternatives)");
      const options = (a.options ?? []).map((o: any, i: number) => ({ label: o.label ?? `option ${i + 1}`, components: o.components ?? [], data: o.data ?? {} }));
      for (const o of options.length ? options : [{ label: "", components: a.components! }]) {
        const errors = problems(o.components, a.made_from);
        if (errors.length) return result("error: " + (o.label ? `${o.label}: ` : "") + errors.join("; "));
      }
      const old = ui.surfaces[a.surface] ?? {}, catalog = readCatalog(), boards = host.api.boards;
      if (typeof a.board === "number" && boards && !boards.has(a.board))
        return result(`error: no board ${a.board}. Boards: ${boards.list().join(", ")} (or board "new")`);
      const first = options[0] ?? { components: a.components, data: a.data ?? {} };
      const record: any = { owner: agent, components: first.components, data: first.data, place: a.place ?? old.place ?? null,
        draggable: a.draggable ?? true, resizable: a.resizable ?? true, about: a.about ?? old.about ?? "",
        kinds: Object.fromEntries((options.length ? options : [first]).flatMap((o: any) => o.components)
          .map((c: any) => [c.component, catalog[c.component].about?.version ?? 1])) };
      for (const [k, v] of [["made_from", a.made_from ?? old.made_from], ["instruction", a.instruction ?? old.instruction],
                            ["options", options.length ? options : null]] as const) if (v) record[k] = v;
      // its board (boards/): the one asked for, a new one, where it already is, or the one the user is on
      if (boards) record.board = a.board === "new" ? boards.add() : a.board ?? old.board ?? boards.current();
      ui.change(a.surface, record, agent, `${agent} drew ${a.surface}` + (options.length ? ` (${options.length} options)` : ""));
      const where = boards ? `on board ${record.board}${a.board === "new" ? " (a new board)" : ""}` : "on screen";
      return result(options.length ? `surface '${a.surface}' shows ${options.length} options ${where}; the user flips through them and keeps one`
        : `surface '${a.surface}' is ${where}`);
    },
  });

  pi.registerTool({
    name: "ui_update", label: "UI update", description: "Change one value in a surface's data (e.g. a score or a list).",
    parameters: Type.Object({ surface: Type.String(), path: Type.String({ description: "e.g. /score" }), value: Type.Any() }),
    async execute(_id, a) {
      if (!(a.surface in ui.surfaces)) return result(`error: no surface '${a.surface}'. Surfaces: ${Object.keys(ui.surfaces).join(", ")}`);
      const locked = ui.locked(a.surface);
      if (locked) return result(locked);
      const r = ui.get(a.surface);
      setPath(r.data, a.path, a.value);
      const agent = pi.getSessionName() ?? "agent";
      ui.change(a.surface, r, agent, `${agent} changed ${a.path} in ${a.surface}`);
      return result("updated");
    },
  });

  pi.registerTool({
    name: "ui_delete", label: "UI delete", description: "Remove a UI surface.",
    parameters: Type.Object({ surface: Type.String() }),
    async execute(_id, a) {
      const locked = ui.locked(a.surface);
      if (locked) return result(locked);
      const users = ui.copyIntoUsers(a.surface), agent = pi.getSessionName() ?? "agent";
      ui.change(a.surface, null, agent, `${agent} deleted ${a.surface}` + (users.length ? ` (${users.join(", ")} got a copy)` : ""));
      return result("deleted" + (users.length ? `; ${users.join(", ")} read from it, so they got a copy of its data` : ""));
    },
  });

  // The page side: registered once for all agents (keyed by name, so each agent's load replaces the last one)
  host.routes.set("/ui-api/catalog", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(Object.fromEntries(Object.entries(readCatalog()).map(([n, m]: any) => [n, m.mtime])))));
  host.routes.set("/ui-api/about", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(Object.fromEntries(Object.entries(readCatalog()).filter(([, m]: any) => m.about).map(([n, m]: any) => [n, m.about])))));
  host.routes.set("/ui/", (req: any, res: any) => {
    let url = "";
    try { url = path.posix.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)); } catch {}  // bad %-escape: 404
    if (!url.startsWith("/ui/")) return res.writeHead(404).end();  // also a ".." out of /ui/
    const p = url.slice("/ui/".length);
    if (p.startsWith("apps/")) return host.file(res, path.join(APPS, p.slice("apps/".length)));
    const lib = p.slice("node_modules/".length);
    if (p.startsWith("node_modules/")) return LIBS.some((l) => lib.startsWith(l)) ? host.file(res, path.join(host.modules, lib)) : res.writeHead(404).end();
    if (!SERVED.some((s) => p === s || (s.endsWith("/") && p.startsWith(s)))) return res.writeHead(404).end();
    host.file(res, path.join(import.meta.dirname, p));
  });
  host.routes.set("/ui-api/surfaces", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ui.surfaces)));
  host.pageHandlers.set("ui", (msg: any) => {
    const { type, surface: sid } = msg;
    const r = typeof sid === "string" ? ui.get(sid) : undefined;
    if (!r) return;
    if (type === "ui_close") {
      const users = ui.copyIntoUsers(sid);
      ui.change(sid, null, "user", `you closed ${sid}` + (users.length ? ` (${users.join(", ")} got a copy)` : ""));
    }
    else if (type === "ui_move") {
      if (r.pinned) return host.broadcast("ui", { op: "render", surface: sid, ...r });
      r.place = msg.place; ui.change(sid, r, "user", `you moved ${sid}`);
    } else if (type === "ui_board" && host.api.boards?.has(msg.board)) {  // dropped on another board's thumbnail
      if (r.pinned) return host.broadcast("ui", { op: "render", surface: sid, ...r });
      r.board = msg.board; r.place = msg.place ?? null; ui.change(sid, r, "user", `you moved ${sid} to board ${msg.board}`);
    } else if (type === "ui_set") { setPath(r.data, msg.path ?? "/", msg.value); ui.change(sid, r, "user", `you changed ${msg.path} in ${sid}`); }
    else if (type === "ui_prop") {
      for (const c of r.components) if (c.id === msg.component && !["id", "component", "children", "child"].includes(msg.prop)) c[msg.prop] = msg.value;
      ui.change(sid, r, "user", `you set ${msg.prop} of ${msg.component} in ${sid}`);
    } else if (type === "ui_pin") { r.pinned = !!msg.pinned; ui.change(sid, r, "user", `you ${r.pinned ? "pinned" : "unpinned"} ${sid}`); }
    else if (type === "ui_keep" && r.options) {
      const o = r.options[Number(msg.index ?? 0)];
      delete r.options;
      if (o) { r.components = o.components; r.data = o.data; ui.change(sid, r, "user", `you kept ${o.label} of ${sid}`); }
    } else if (type === "ui_action") {
      r.data = msg.data ?? r.data;
      ui.change(sid, r, "user", `you used ${msg.name} in ${sid}`);
      host.send("user", r.owner, `[ui action] ${msg.name} on surface '${sid}' (component ${msg.component})\n`
        + `context: ${JSON.stringify(msg.context ?? {})}\ndata: ${JSON.stringify(r.data)}`);
    }
  });
}
