// Cards: what the agents show the user, each one thing on a board in the page's main space (browser.js draws them).
// A card shows blocks (a JSON list of pieces from blocks/*.js: Text, Button, Table...) or an app (a page of its own in
// built/apps/<name>/, in a frame; the app extension serves its data and its bridge to the agents).
// Tools card_blocks, card_show, card_update, card_remove. card_show of an app opens the page in the browser-check
// skill's headless browser and says what it found: errors, and whether the app fits its card. The cards are shared by every agent: one Cards object on
// the host, made by whichever agent loads first.
// One door: every change goes through change(): it saves, tells every open page, and calls every watcher with the
// card, who did it and the words for it ("you moved s1"; none: part of a bigger change). restore() puts back a
// saved state (not a change: no watchers). Watchers, registered from session_start:
//   host.api.card.watch(name, fn(card, by, what))   name: the extension's, so its reload replaces its own
// (history: a step per change with words; frame: a frame is done when its card appears).
//   built/card.json  each card but its data (versioned)      data/card.json  each card's data (what users typed)
// A card: {owner, blocks | app, data, place, board, about, pinned, options, made_from, instruction, draggable,
//   resizable, height (an app's, when nothing else sizes it), kinds (each block's about.version, for upgrades)}.
//   app: the page's path in built/, e.g. "apps/habit/index.html" (card_show takes the full path).
//   GET /card/all           every card                   GET /card/about   block name -> its about block
//   GET /card/blocks        block name -> mtime          GET /card/blocks/<Name>.js, /card/node_modules/{marked,dompurify}/...
//   GET /card/lib/...       libraries the agents added for blocks (lib/ here: ES-module builds)
//   page messages           card_set, card_prop, card_move, card_board, card_pin, card_keep, card_close, card_action
//   page event "card"       {op: "render", card, ...record} | {op: "delete", card} | {op: "reset", cards}
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const DESIGN = path.join(host.built, "card.json");
const DATA = path.join(host.data, "card.json");
const BLOCKS = path.join(import.meta.dirname, "blocks");
const LIB = path.join(import.meta.dirname, "lib");
const LIBS = ["marked/", "dompurify/"];  // the browser libraries blocks import, from the host's node_modules (its package.json)
const read = (p: string, d: any) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const clone = (v: any) => structuredClone(v);
const isRef = (v: any) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "path,ref";
const STRUCTURE = ["id", "block", "children", "child"];  // what makes the tree: changed only by card_show
const propsOf = (b: any) => Object.fromEntries(Object.entries(b).filter(([k]) => ![...STRUCTURE, "when"].includes(k)));

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
const watchers: Map<string, (id: string, by?: string, what?: string) => void> = host.shared.get("card-watchers") ?? new Map();
host.shared.set("card-watchers", watchers);
host.api.card = { watch: (name: string, fn: (id: string, by?: string, what?: string) => void) => watchers.set(name, fn) };

class Cards {
  cards: Record<string, any> = read(DESIGN, {});
  constructor() {
    const data = read(DATA, {});
    for (const [id, r] of Object.entries(this.cards)) r.data = data[id] ?? {};
  }
  save() {
    fs.writeFileSync(DESIGN, JSON.stringify(Object.fromEntries(Object.entries(this.cards)
      .map(([id, r]) => [id, { ...r, data: undefined }])), null, 1));
    fs.writeFileSync(DATA, JSON.stringify(Object.fromEntries(Object.entries(this.cards).map(([id, r]) => [id, r.data ?? {}]))));
  }
  get(id: string) { return clone(this.cards[id]); }
  snapshot() { return clone(this.cards); }
  // record null: delete. by: "user" or an agent; what: the history's words for it (none: part of a bigger change,
  // so no step of its own; the last change makes one)
  change(id: string, record: any, by?: string, what?: string) {
    if (record === null) delete this.cards[id];
    else this.cards[id] = record;
    this.save();
    host.broadcast("card", record === null ? { op: "delete", card: id } : { op: "render", card: id, ...record });
    for (const [name, fn] of watchers) {
      try { fn(id, by, what); }
      catch (e) { host.broadcast("error", { agent: "server", text: `card watcher ${name}: ${e}` }); }  // one broken watcher doesn't stop the rest
    }
  }
  load() {  // read the files again (after a rollback changed built/card.json); true if the cards changed
    const before = JSON.stringify(this.cards), design = read(DESIGN, {}), data = read(DATA, {});
    for (const [id, r] of Object.entries(design) as any) r.data = data[id] ?? {};
    this.cards = design;
    host.broadcast("card", { op: "reset", cards: this.cards });
    return JSON.stringify(this.cards) !== before;
  }
  restore(cards: Record<string, any>) {  // a whole saved state (undo, redo, rewind): not a change of its own
    this.cards = clone(cards);
    this.save();
    host.broadcast("card", { op: "reset", cards: this.cards });
  }
  locked(id: string) {
    return this.cards[id]?.pinned ? `error: card '${id}' is pinned by the user, so agents can't change or remove it. `
      + `Make a new card instead (made_from=['${id}'] keeps the link), or ask the user to unpin it.` : null;
  }
  copyIntoUsers(id: string) {  // before id goes: cards reading from it get its current values
    const users = Object.keys(this.cards).filter((o) => o !== id && (this.cards[o].blocks ?? [])
      .some((b: any) => Object.values(propsOf(b)).some((v: any) => isRef(v) && v.ref === id)));
    for (const o of users) {
      const r = this.get(o);
      for (const b of r.blocks)
        for (const [k, v] of Object.entries(propsOf(b)) as any)
          if (isRef(v) && v.ref === id) b[k] = clone(getPath(this.cards[id].data, v.path));
      this.change(o, r);
    }
    return users;
  }
}

if (!host.shared.has("card")) host.shared.set("card", new Cards());
const cards: Cards = host.shared.get("card");

function problems(blocks: any[], madeFrom: string[] = []) {
  const catalog = readCatalog(), ids = new Set(blocks.map((b) => b.id));
  const errors = ids.has("root") ? [] : ['one block must have "id": "root"'];
  for (const b of blocks) {
    if (!(b.block in catalog)) { errors.push(`${b.id}: unknown block '${b.block}' (have: ${Object.keys(catalog).join(", ")})`); continue; }
    for (const child of [...(b.children ?? []), ...(b.child ? [b.child] : [])])
      if (!ids.has(child)) errors.push(`${b.id}: child '${child}' is not defined`);
    if (b.when && !(typeof b.when === "object" && typeof b.when.path === "string" && "is" in b.when))
      errors.push(`${b.id}: when must be {"path": "/x", "is": value}`);
    const known = catalog[b.block].about?.props;
    for (const [k, v] of Object.entries(propsOf(b)) as any) {
      if (known && !(k in known)) errors.push(`${b.id}: ${b.block} has no prop '${k}' (props: ${Object.keys(known).join(", ") || "none"})`);
      if (isRef(v) && !(v.ref in cards.cards)) errors.push(`${b.id}.${k}: refers to card '${v.ref}', which does not exist`);
    }
  }
  const byId = new Map(blocks.map((b) => [b.id, b])), drawn = new Set<string>();
  const walk = (id: string) => {  // what is drawn: root and what it contains, down
    if (drawn.has(id) || !byId.has(id)) return;
    drawn.add(id);
    const b = byId.get(id);
    for (const c of [...(b.children ?? []), ...(b.child ? [b.child] : [])]) walk(c);
  };
  walk("root");
  const orphans = ids.has("root") ? [...ids].filter((id) => !drawn.has(id)) : [];
  if (orphans.length) errors.push(`${orphans.join(", ")}: not inside root (no block lists ${orphans.length > 1 ? "them" : "it"} in children or child), so never drawn`);
  return [...errors, ...madeFrom.filter((m) => !(m in cards.cards)).map((m) => `made_from: no card '${m}'`)];
}

// An app's page, given as its name ("habit": apps/habit/index.html), its path in built/ or its full path: its path in
// built/, or an error that says where it should be
function appPath(given: string): { app?: string; error?: string } {
  const apps = path.join(host.built, "apps");
  const full = !given.includes("/") ? path.join(apps, given, "index.html")
    : path.isAbsolute(given) ? given : path.join(host.built, given.replace(/^\/?(built\/)?/, ""));
  const p = path.resolve(full);
  if (!p.startsWith(apps + path.sep)) return { error: `an app's page is a file in ${apps}/<name>/ (e.g. ${apps}/habit/index.html); ${full} is not` };
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { error: `no file ${p}: write the app's page there first` };
  return { app: path.relative(host.built, p).split(path.sep).join("/") };
}

// The blocks (blocks/*.js): {name: {doc, mtime, about, problem}}; doc = the comment lines at the top
function readCatalog() {
  const out: Record<string, any> = {};
  for (const f of fs.readdirSync(BLOCKS).filter((f) => f.endsWith(".js")).sort()) {
    const text = fs.readFileSync(path.join(BLOCKS, f), "utf8");
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
    out[f.slice(0, -3)] = { doc: doc.join("\n"), mtime: Math.floor(fs.statSync(path.join(BLOCKS, f)).mtimeMs / 1000), about, problem };
  }
  return out;
}

// An app card as the user sees it: the page opened in the headless browser of the browser-check skill, its errors and
// whether the app fits its card. A few seconds; what it can't do (no browser yet) it says, and the card stays.
function checkOnBoard(id: string): Promise<string> {
  const script = path.join(host.agent, "skills/browser-check/scripts/check.mjs");
  const measure = `eval:(()=>{const f=document.querySelector('[data-card="${id}"] iframe'); if(!f) return 'none';
    const d=f.contentDocument; return f.clientHeight+' '+d.documentElement.scrollHeight+' '+f.clientWidth+' '+d.documentElement.scrollWidth})()`;
  return new Promise((resolve) => execFile(process.execPath, [script, `http://127.0.0.1:${host.port}/`, "wait:2500", measure],
    { timeout: 45000 }, (err, stdout) => {
      const errors = /errors \((\d+)\):\n?([\s\S]*?)\n?layout problems/.exec(stdout ?? "");
      const m = /-> "(\d+) (\d+) (\d+) (\d+)"/.exec(stdout ?? "");
      if (!errors) return resolve(`not checked (${String(err?.message ?? stdout).split("\n")[0].slice(0, 200)})`);
      const said = Number(errors[1]) ? `${errors[1]} error(s): ${errors[2].trim().slice(0, 600)}` : "no errors";
      const fit = !m ? "not on the board the user is on, so not measured"
        : Number(m[2]) > Number(m[1]) + 2 ? `its content is ${m[2]}px tall in a ${m[1]}px card, so it scrolls inside: make it fit (or pass height=${Number(m[2]) + 8})`
        : Number(m[4]) > Number(m[3]) + 2 ? `its content is ${m[4]}px wide in a ${m[3]}px card: make it fit` : "it fits its card";
      resolve(`checked on the board: ${said}; ${fit}`);
    }));
}

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const Place = Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Optional(Type.Number()), height: Type.Optional(Type.Number()) },
  { description: "pin it at a spot (px from the main space's top-left); leave out to stack it" }));

export default function (pi: ExtensionAPI) {
  // a removed board (board/) takes its cards with it: one step in the history (undo brings them back)
  pi.on("session_start", () => host.api.board?.onRemove("card", (n: number) => {
    const ids = Object.keys(cards.cards).filter((id) => (cards.cards[id].board ?? 1) === n);
    const gone = ids.map((id) => ({ owner: cards.cards[id].owner, what: `card ${id}` }));
    ids.forEach((id, i) => {
      cards.copyIntoUsers(id);  // cards elsewhere reading from it keep its values
      cards.change(id, null, "user", i === ids.length - 1 ? `you removed board ${n} (${ids.join(", ")})` : undefined);
    });
    return gone;
  }));

  pi.registerTool({
    name: "card_blocks", label: "Card blocks", exposure: "deferred", description: "List the blocks you can build a card from, with their props.",
    parameters: Type.Object({}),
    async execute() {
      const catalog = readCatalog();
      const broken = Object.entries(catalog).filter(([, m]: any) => m.problem).map(([n, m]: any) => `${n}: ${m.problem}`);
      return result(`Before your first blocks card or a new block, read ${path.join(import.meta.dirname, "README.md")} (bindings, `
        + `when, tabs, refs, options, new blocks).\n\n` + Object.values(catalog).map((m: any) => m.doc + (m.about ? `\nabout: ${JSON.stringify(m.about)}` : "")).join("\n\n")
        + (broken.length ? `\n\nProblems:\n${broken.join("\n")}` : ""));
    },
  });

  pi.registerTool({
    name: "card_show", label: "Card show", description: "Show a card on a board, or replace one: built from blocks, or an app "
      + "(a page you wrote in the apps folder of what you built).",
    parameters: Type.Object({
      card: Type.String({ description: "its id: a clear name (the user points at things by name)" }),
      blocks: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: 'e.g. [{"id": "root", "block": "Text", "text": "hi"}]' })),
      app: Type.Optional(Type.String({ description: "instead of blocks: the app's name (its page is <built>/apps/<name>/index.html)" })),
      height: Type.Optional(Type.Number({ description: "an app's height in px when nothing else sizes it (default 400)" })),
      data: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "the blocks' data; leave out to keep the card's data" })),
      place: Place,
      draggable: Type.Optional(Type.Boolean()), resizable: Type.Optional(Type.Boolean()),
      about: Type.Optional(Type.String({ description: "what it is for and why it is built this way (its back side)" })),
      options: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: 'alternatives instead of blocks or app: [{"label", "blocks" or "app", "data"}]' })),
      made_from: Type.Optional(Type.Array(Type.String())), instruction: Type.Optional(Type.String()),
      board: Type.Optional(Type.Union([Type.Number(), Type.Literal("new")], { description:
        'a board number, or "new" for a new board; leave out: where the card is, else the board the user is on' })),
    }),
    async execute(_id, a) {
      const agent = pi.getSessionName() ?? "agent";
      const locked = cards.locked(a.card);
      if (locked) return result(locked);
      if ([a.blocks, a.app, a.options].filter((v) => v !== undefined).length !== 1) return result("error: give one of blocks, app or options");
      const old = cards.cards[a.card] ?? {}, catalog = readCatalog(), boards = host.api.board;
      // the content: {blocks, data} or {app}, checked; each option is one too
      const content = (o: any, label = "") => {
        if (o.app !== undefined) {
          const { app, error } = appPath(o.app);
          return error ? { error: (label && `${label}: `) + error } : { app };
        }
        const errors = problems(o.blocks ?? [], a.made_from);
        return errors.length ? { error: (label && `${label}: `) + errors.join("; ") } : { blocks: o.blocks ?? [] };
      };
      const options = [];
      for (const [i, o] of (a.options ?? []).entries()) {
        const label = o.label ?? `option ${i + 1}`, c: any = content(o, label);
        if (c.error) return result("error: " + c.error);
        options.push({ label, ...c, data: o.data ?? {} });
      }
      const main: any = options[0] ?? content(a);
      if (main.error) return result("error: " + main.error);
      if (typeof a.board === "number" && boards && !boards.has(a.board))
        return result(`error: no board ${a.board}. Boards: ${boards.list().join(", ")} (or board "new")`);
      const record: any = { owner: agent, ...(main.app ? { app: main.app } : { blocks: main.blocks }),
        data: options.length ? main.data : a.data ?? old.data ?? {}, place: a.place ?? old.place ?? null,
        draggable: a.draggable ?? true, resizable: a.resizable ?? true, about: a.about ?? old.about ?? "",
        kinds: Object.fromEntries((options.length ? options : [main]).flatMap((o: any) => o.blocks ?? [])
          .map((b: any) => [b.block, catalog[b.block].about?.version ?? 1])) };
      for (const [k, v] of [["height", main.app ? a.height ?? old.height : undefined], ["made_from", a.made_from ?? old.made_from],
                            ["instruction", a.instruction ?? old.instruction], ["options", options.length ? options : null]] as const) if (v) record[k] = v;
      // its board (board/): the one asked for, a new one, where it already is, or the one the user is on
      if (boards) record.board = a.board === "new" ? boards.add() : a.board ?? old.board ?? boards.current();
      cards.change(a.card, record, agent, `${agent} showed ${a.card}` + (options.length ? ` (${options.length} options)` : ""));
      const where = boards ? `on board ${record.board}${a.board === "new" ? " (a new board)" : ""}` : "on screen";
      if (options.length) return result(`card '${a.card}' shows ${options.length} options ${where}; the user flips through them and keeps one`);
      if (!main.app) return result(`card '${a.card}' is ${where}`);
      return result(`card '${a.card}' is ${where}, showing ${host.built}/${main.app} (at http://127.0.0.1:${host.port}/built/${main.app}); `
        + await checkOnBoard(a.card) + ". Errors and fit are all this checked: now use it as the user would (load the "
        + "test-your-app skill) before you tell the user what it does.");
    },
  });

  pi.registerTool({
    name: "card_update", label: "Card update", description: "Change one value in a card's data (e.g. a score or a list), "
      + "or with block, one prop of that block (e.g. a label): the rest of the card stays as it is.",
    parameters: Type.Object({ card: Type.String(),
      path: Type.String({ description: "a data path, e.g. /score; with block: the prop, e.g. text" }), value: Type.Any(),
      block: Type.Optional(Type.String({ description: "a block's id: change its prop instead of data" })) }),
    async execute(_id, a) {
      if (!(a.card in cards.cards)) return result(`error: no card '${a.card}'. Cards: ${Object.keys(cards.cards).join(", ")}`);
      const locked = cards.locked(a.card);
      if (locked) return result(locked);
      const r = cards.get(a.card), agent = pi.getSessionName() ?? "agent";
      if (a.block !== undefined) {  // as the page's card_prop: the structure only via card_show
        const b = (r.blocks ?? []).find((b: any) => b.id === a.block);
        if (!b) return result(`error: no block '${a.block}' in ${a.card}. Blocks: ${(r.blocks ?? []).map((b: any) => b.id).join(", ") || "none (an app)"}`);
        if (STRUCTURE.includes(a.path)) return result(`error: '${a.path}' changes the structure: use card_show`);
        b[a.path] = a.value;
        const errors = problems(r.blocks, r.made_from);
        if (errors.length) return result("error: " + errors.join("; "));
        cards.change(a.card, r, agent, `${agent} set ${a.path} of ${a.block} in ${a.card}`);
        return result("updated");
      }
      setPath(r.data, a.path, a.value);
      cards.change(a.card, r, agent, `${agent} changed ${a.path} in ${a.card}`);
      return result("updated");
    },
  });

  pi.registerTool({
    name: "card_remove", label: "Card remove", description: "Take a card off its board.",
    parameters: Type.Object({ card: Type.String() }),
    async execute(_id, a) {
      if (!(a.card in cards.cards)) return result(`error: no card '${a.card}'. Cards: ${Object.keys(cards.cards).join(", ")}`);
      const locked = cards.locked(a.card);
      if (locked) return result(locked);
      const users = cards.copyIntoUsers(a.card), agent = pi.getSessionName() ?? "agent";
      cards.change(a.card, null, agent, `${agent} removed ${a.card}` + (users.length ? ` (${users.join(", ")} got a copy)` : ""));
      return result("removed" + (users.length ? `; ${users.join(", ")} read from it, so they got a copy of its data` : ""));
    },
  });

  // The page side: registered once for all agents (keyed by name, so each agent's load replaces the last one)
  const json = (res: any, v: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
  host.routes.set("/card/all", (_req: any, res: any) => json(res, cards.cards));
  host.routes.set("/card/blocks", (_req: any, res: any) => json(res, Object.fromEntries(Object.entries(readCatalog()).map(([n, m]: any) => [n, m.mtime]))));
  host.routes.set("/card/about", (_req: any, res: any) =>
    json(res, Object.fromEntries(Object.entries(readCatalog()).filter(([, m]: any) => m.about).map(([n, m]: any) => [n, m.about]))));
  host.routes.set("/card/", (req: any, res: any) => {  // the blocks' code and the libraries they import
    let url = "";
    try { url = path.posix.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)); } catch {}  // bad %-escape: 404
    if (url.startsWith("/card/blocks/") && url.endsWith(".js")) return host.file(res, path.join(BLOCKS, url.slice("/card/blocks/".length)));
    if (url.startsWith("/card/lib/")) return host.file(res, path.join(LIB, url.slice("/card/lib/".length)));
    const lib = url.slice("/card/node_modules/".length);
    if (url.startsWith("/card/node_modules/") && LIBS.some((l) => lib.startsWith(l))) return host.file(res, path.join(host.modules, lib));
    res.writeHead(404).end();  // also a ".." out of /card/
  });
  host.pageHandlers.set("card", (msg: any) => {
    const { type, card: id } = msg;
    const r = typeof id === "string" ? cards.get(id) : undefined;
    if (!r || !type?.startsWith("card_")) return;
    if (type === "card_close") {
      const users = cards.copyIntoUsers(id);
      cards.change(id, null, "user", `you closed ${id}` + (users.length ? ` (${users.join(", ")} got a copy)` : ""));
    }
    else if (type === "card_move") {
      if (r.pinned) return host.broadcast("card", { op: "render", card: id, ...r });
      r.place = msg.place; cards.change(id, r, "user", `you moved ${id}`);
    } else if (type === "card_board" && host.api.board?.has(msg.board)) {  // dropped on another board's thumbnail
      if (r.pinned) return host.broadcast("card", { op: "render", card: id, ...r });
      r.board = msg.board; r.place = msg.place ?? null; cards.change(id, r, "user", `you moved ${id} to board ${msg.board}`);
    } else if (type === "card_set") { setPath(r.data, msg.path ?? "/", msg.value); cards.change(id, r, "user", `you changed ${msg.path} in ${id}`); }
    else if (type === "card_prop") {
      for (const b of r.blocks ?? []) if (b.id === msg.block && !STRUCTURE.includes(msg.prop)) b[msg.prop] = msg.value;
      cards.change(id, r, "user", `you set ${msg.prop} of ${msg.block} in ${id}`);
    } else if (type === "card_pin") { r.pinned = !!msg.pinned; cards.change(id, r, "user", `you ${r.pinned ? "pinned" : "unpinned"} ${id}`); }
    else if (type === "card_keep" && r.options) {
      const o = r.options[Number(msg.index ?? 0)];
      delete r.options;
      if (o) {
        delete r.blocks; delete r.app;
        Object.assign(r, o.app ? { app: o.app } : { blocks: o.blocks }, { data: o.data });
        cards.change(id, r, "user", `you kept ${o.label} of ${id}`);
      }
    } else if (type === "card_action") {
      r.data = msg.data ?? r.data;
      cards.change(id, r, "user", `you used ${msg.name} in ${id}`);
      host.send("user", r.owner, `[card action] ${msg.name} on card '${id}' (${msg.block === "app" ? "its app" : `block ${msg.block}`})\n`
        + `context: ${JSON.stringify(msg.context ?? {})}\ndata: ${JSON.stringify(r.data)}`);
    }
  });
}
