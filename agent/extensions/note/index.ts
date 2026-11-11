// Notes on the page (browser.js: the pen, the note box, the pins and their threads): a note is a thread pinned on a
// thing, and both the user and the agents can start one and reply in it.
//   note_add (page)  click anything on the page (or draw around an area) and write: the target is the card,
//                    block, element, part (partAt), its text and source file, the spot and the area.
//                    Files dropped on the page come as a note too ("files": paths in <workspace>/drops).
//                    Written by an agent's code through the page (msg.by, page/browser.js): that agent's own note.
//   note_combine     the user dragged card a onto card b and wrote how to combine them. The agent changes b to
//                    take a in, reading a's data live ({"ref"} props); a stays as it is.
//   note_reply       the user wrote in a note's thread (its bubble): it goes to the note's agent, with the thread so far
//   note_close / note_reopen / note_delete   the user's ✓ (close) or ✕ (delete, for good; open or closed) at the
//                    bubble's top right, Reopen on a closed one
// The agents' tools: note_add(on, text) starts a thread on a thing (on: as doodle_mark's, checked on the open page),
// note_reply(id, text) writes in one, note_done(id) closes one, note_done(id, delete: true) removes one the agent started
// (never the user's or another agent's). A closed note stays as a faded ✓ pin (the user can reopen or delete it); a
// removed board takes its notes with it.
// Each note goes to the card's owner (else the agent picked in the chat; an agent's own note: that agent), gets an id
// (n1, n2, ...: never reused) and is saved: data/note.json {"last", "notes": {id: {thread: [{by, text, ts}], to, by,
// board, state: "open" | "done", at: {x, y} (main px), anchor: {card, dx, dy}, stroke, target?, box?}}}. The pin sits
// on its card (anchor: where on it), so it moves with it; an agent's note sits on the thing it names (target).
// If the user closes a note its agent hasn't started on, it is taken out of its inbox (the agent never saw it).
//   events  note_pin {id, ...note} (new or changed)   note_gone {id}        GET /note/all
// guide.md: the short prompt section; README.md: the whole of it, read before a first note.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const FILE = path.join(host.data, "note.json");
if (!host.shared.has("note")) {
  const data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 0, notes: {} };
  if (data.open) {  // the older shape: {last, open: {id: {text, to, x, y, stroke, board}}}
    data.notes = Object.fromEntries(Object.entries(data.open).map(([id, n]: any) =>
      [id, { thread: [{ by: "user", text: n.text, ts: Date.now() }], to: n.to, by: "user", board: n.board ?? 1, state: "open", at: { x: n.x, y: n.y }, stroke: n.stroke }]));
    delete data.open;
  }
  host.shared.set("note", data);
}
const D = host.shared.get("note");
if (!host.shared.has("note-items")) host.shared.set("note-items", new Map());
const items: Map<string, any> = host.shared.get("note-items");  // note id -> its latest team inbox item (not saved)
const save = () => fs.writeFileSync(FILE, JSON.stringify(D));
const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const show = (id: string) => host.broadcast("note_pin", { id, ...D.notes[id] });
const opened = () => Object.keys(D.notes).filter((id) => D.notes[id].state === "open");
const remove = (id: string) => {  // a note, for good: off every page
  delete D.notes[id];
  items.delete(id);
  save();
  host.broadcast("note_gone", { id });
};

function pin(note: any) {  // a new note: saved, pinned on every page
  const id = `n${++D.last}`;
  D.notes[id] = { state: "open", ...note };
  save();
  show(id);
  return id;
}

function describe(sid: string) {  // a source of a combine, for the agent: cut short if long
  const r = host.shared.get("card")?.cards[sid] ?? {};
  const text = JSON.stringify({ owner: r.owner, about: r.about, ...(r.app ? { app: r.app } : { blocks: r.blocks }), data: r.data });
  return text.length < 3000 ? text : text.slice(0, 3000) + ` … (more in ${host.built}/card.json and ${host.data}/card.json)`;
}

const thread = (n: any) => n.thread.map((t: any) => `    ${t.by === "user" ? "user" : t.by}: ${t.text}`);

// A thing on the page, as the agent names it (as doodle_mark's "on")
const Target = Type.Object({
  card: Type.Optional(Type.String({ description: "card id" })),
  block: Type.Optional(Type.String({ description: "block id in that card" })),
  element: Type.Optional(Type.String({ description: "a CSS selector, or an element's id or data-name (also inside an app's frame)" })),
  text: Type.Optional(Type.String({ description: "exact text shown on the page (in the card/element if given)" })),
  mark: Type.Optional(Type.String({ description: "a mark's id (m3)" })),
}, { description: "What the note is on: give as few fields as name it exactly, e.g. {card, text}." });

export default function (pi: ExtensionAPI) {
  const me = () => pi.getSessionName()!;
  // a removed board (board/) takes its notes with it; a note its agent hasn't seen yet is just taken back
  pi.on("session_start", () => host.api.board?.onRemove("note", (n: number) => {
    const gone: { owner: string; what: string }[] = [];
    for (const id of Object.keys(D.notes).filter((id) => (D.notes[id].board ?? 1) === n)) {
      const note = D.notes[id], item = items.get(id);
      delete D.notes[id];
      items.delete(id);
      host.broadcast("note_gone", { id });
      if (note.state === "open" && !(item && host.api.team?.withdraw(item))) gone.push({ owner: note.to, what: `note ${id} ("${note.thread[0]?.text}")` });
    }
    save();
    return gone;
  }));

  pi.registerTool({
    name: "note_add", label: "Note add",
    description: "Pin a note (a thread) on a thing on the page, to explain something there or ask the user about it. "
      + "The user replies in it; their reply comes to you. Short pointers go on the board instead (doodle_mark).",
    parameters: Type.Object({ on: Target, text: Type.String() }),
    async execute(_id, a) {
      const where = await host.api.doodle?.check(a.on);
      if (where?.error) return result(`error: ${where.error}. Name it as it is on the page: a card id, a block id, an element's id or data-name, or its exact text.`);
      const id = pin({ thread: [{ by: me(), text: a.text, ts: Date.now() }], to: me(), by: me(), target: a.on,
                       board: where?.board ?? host.api.board?.current() ?? 1, ...(where?.box && { box: where.box }) });
      return result(`pinned note ${id}; the user reads it there (don't repeat it in your reply) and their replies come to you as "[note reply on the page]"`
        + (where ? "" : " (no page open to check the target: it shows when one opens)"));
    },
  });

  pi.registerTool({
    name: "note_reply", label: "Note reply",
    description: "Write in a note's thread (answer the user there, any length). A closed note opens again.",
    parameters: Type.Object({ id: Type.String({ description: "e.g. n3" }), text: Type.String() }),
    async execute(_id, a) {
      const n = D.notes[a.id];
      if (!n) return result(`error: no note '${a.id}'. Notes: ${Object.keys(D.notes).join(", ") || "none"}`);
      n.thread.push({ by: me(), text: a.text, ts: Date.now() });
      n.state = "open";
      save();
      show(a.id);
      return result(`replied in note ${a.id}; the user reads it there: don't repeat it in your reply`);
    },
  });

  pi.registerTool({
    name: "note_done", label: "Note done", description: "Close a note that is dealt with (you did what it asked): its pin turns into a faded ✓ (the user can "
      + "reopen it). Not while your answer waits on the user (a suggestion, a question). With delete: true, a note you started "
      + "goes from the page instead (open or closed), e.g. one that explained a step and has served its purpose.",
    parameters: Type.Object({ id: Type.String({ description: "e.g. n3" }),
      delete: Type.Optional(Type.Boolean({ description: "remove it from the page for good: only notes you started" })) }),
    async execute(_id, a) {
      const n = D.notes[a.id];
      if (a.delete) {
        if (!n) return result(`error: no note '${a.id}'`);
        if (n.by !== me()) return result(`error: ${a.id} was started by ${n.by === "user" ? "the user" : n.by}: only its starter deletes it. Close it instead (note_done without delete).`);
        remove(a.id);
        return result(`note ${a.id} is gone from the page`);
      }
      if (!n || n.state !== "open") return result(`error: no open note '${a.id}'. Open notes: ${opened().join(", ") || "none"}`);
      n.state = "done";
      items.delete(a.id);
      save();
      show(a.id);
      return result(`note ${a.id} is closed; its pin shows a faded ✓`);
    },
  });

  host.routes.set("/note/all", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(D.notes)));

  host.pageHandlers.set("note", (msg: any) => {
    const team = host.api.team, n = D.notes[msg.id];
    if (msg.type === "note_close" && n?.state === "open") {
      n.state = "done";
      save();
      show(msg.id);
      const item = items.get(msg.id);
      items.delete(msg.id);
      if (host.agents.has(n.to) && !(item && team?.withdraw(item)))
        team?.fyi("page", n.to, `[note on the page] the user closed note ${msg.id} ("${n.thread[0]?.text}"): done with it; drop it if you haven't finished it.`);
      return;
    }
    if (msg.type === "note_reopen" && n?.state === "done") { n.state = "open"; save(); return show(msg.id); }
    if (msg.type === "note_delete" && n) {  // open or closed, for good
      const item = items.get(msg.id);
      remove(msg.id);
      if (host.agents.has(n.to) && !(item && team?.withdraw(item)))  // not seen yet: just take it back
        team?.fyi("page", n.to, `[note on the page] the user deleted note ${msg.id} ("${n.thread[0]?.text}"): it is gone from the page; drop it if you haven't finished it.`);
      return;
    }
    if (msg.type === "note_reply" && n && team && String(msg.text ?? "").trim()) {
      n.thread.push({ by: "user", text: msg.text.trim(), ts: Date.now() });
      n.state = "open";
      save();
      show(msg.id);
      host.api.doodle?.dim();
      const to = host.agents.has(n.to) ? n.to : "agent1";
      const on = n.target ? Object.entries(n.target).map(([k, v]) => `${k} "${v}"`).join(", ") : n.anchor?.card ? `card ${n.anchor.card}` : "the page";
      return items.set(msg.id, team.send("user", to, [`[note reply on the page] ${msg.text.trim()}`,
        `  id: ${msg.id} (on ${on}, board ${n.board}; answer in this thread: note_reply("${msg.id}", ...))`, "  thread so far:", ...thread(n)].join("\n")));
    }
    if (!["note_add", "note_combine"].includes(msg.type) || !team) return;
    host.api.doodle?.dim();
    const text = msg.text ?? "";
    const base = { board: Number(msg.board) || 1, at: msg.at ?? { x: 0, y: 0 }, ...(msg.anchor && { anchor: msg.anchor }),
                   stroke: msg.stroke ?? null };  // with its drawing, if any (main px)
    // an agent's code wrote it through the page's tools (msg.by, page/browser.js): that agent's own note, as if it
    // called note_add; nothing to tell it, it knows (the reply to page_run says what happened)
    if (host.agents.has(msg.by)) {
      pin({ ...base, to: msg.by, by: msg.by, thread: [{ by: msg.by, text: msg.type === "note_combine" ? `combine ${msg.a} into ${msg.b}: ${text}` : text, ts: Date.now() }] });
      return;
    }
    const to = host.agents.has(msg.to) ? msg.to : "agent1";
    const note = { ...base, to, by: "user" };
    if (msg.type === "note_combine") {
      const { a, b } = msg;
      const madeFrom = [...(host.shared.get("card")?.cards[b]?.made_from ?? []).filter((m: string) => m !== a), a];
      const id = pin({ ...note, thread: [{ by: "user", text: `combine ${a} into ${b}: ${text}`, ts: Date.now() }] });
      return items.set(id, team.send("user", to, [`[combine on the page] ${text}`, `  id: ${id} (call note_done("${id}") when dealt with)`,
        `  board: ${note.board}`,
        `  dragged: ${a} (keep it as it is)`, `  onto: ${b} (change this one)`,
        `  so: card_show(card="${b}", ..., made_from=${JSON.stringify(madeFrom)}, instruction=<their words>), reading ${a}'s data with {"ref": "${a}", "path": ...}`,
        `  ${a}: ${describe(a)}`, `  ${b}: ${describe(b)}`].join("\n")));
    }
    const t = msg.target ?? {};
    const at = t.at && `${t.at.x} across, ${t.at.y} down the element`;
    const pos = t.position && `x=${t.position.x}, y=${t.position.y} px in the main space (for card_show's place)`;
    const area = t.area && `x=${t.area.x}, y=${t.area.y}, width=${t.area.width}, height=${t.area.height} px in the main space `
      + (t.card ? "(the user drew around this part of the card: the note is about it)" : "(the user drew around empty space: build inside it)");
    const id = pin({ ...note, thread: [{ by: "user", text, ts: Date.now() }] });
    const lines = [`[note on the page] ${text}`, `  id: ${id} (answer in its thread: note_reply("${id}", ...); note_done("${id}") when dealt with)`,
      ...([["board", note.board], ["card", t.card], ["block", (t.blocks ?? []).join(" → ")], ["element", t.element],
           ["part", t.part && JSON.stringify(t.part)], ["at", at], ["text", t.text], ["file", t.file && path.join(host.home, t.file)], ["position", pos],
           ["area", area], ["files", msg.files?.join(", ")]] as [string, any][]).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`)];
    items.set(id, team.send("user", to, lines.join("\n")));
  });
}
