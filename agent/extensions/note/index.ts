// Notes on the page (browser.js: the pen, the note box and the pins): the user points at
// things and writes a note there; the note and its target go to an agent, so it knows exactly what it is about.
//   note_add       click anything on the page (or draw around an area) and write: the target is the card,
//                  block, element, part (partAt), its text and source file, the spot and the area.
//                  Files dropped on the page come as a note too ("files": paths in <workspace>/drops).
//   note_combine   the user dragged card a onto card b and wrote how to combine them. The agent changes b to
//                  take a in, reading a's data live ({"ref"} props); a stays as it is.
// Each note goes to the card's owner (else the agent picked in the chat), gets an id (n1, n2, ...: never reused)
// and stays pinned (data/note.json: {"last", "open": {id: note}}, redrawn after a reload) until the agent calls
// note_done(id). The user can also close a pin (its ✕): the note is dropped, and taken out of its agent's inbox if
// its turn hasn't started (the agent never saw it); else its agent is told (a note).
// guide.md: the short prompt section; README.md (copied from point.py): the whole of it, read before a first note.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const FILE = path.join(host.data, "note.json");
if (!host.shared.has("note"))
  host.shared.set("note", fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 0, open: {} });
const notes = host.shared.get("note");  // {last, open: {id: {text, to, x, y, stroke, board}}}
if (!host.shared.has("note-items")) host.shared.set("note-items", new Map());
const items: Map<string, any> = host.shared.get("note-items");  // note id -> its team inbox item (not saved)
const save = () => fs.writeFileSync(FILE, JSON.stringify(notes));

function pin(text: string, to: string, msg: any) {  // a new open note: saved, pinned on every page
  const id = `n${++notes.last}`;
  notes.open[id] = { text, to, x: msg.x ?? 0, y: msg.y ?? 0, stroke: msg.stroke ?? null,  // with its drawing, if any
                     board: Number(msg.board) || 1 };  // the board it was written on (board/): its pin shows there
  save();
  host.broadcast("note_pin", { id, ...notes.open[id] });
  return id;
}

function describe(sid: string) {  // a source of a combine, for the agent: cut short if long
  const r = host.shared.get("card")?.cards[sid] ?? {};
  const text = JSON.stringify({ owner: r.owner, about: r.about, ...(r.app ? { app: r.app } : { blocks: r.blocks }), data: r.data });
  return text.length < 3000 ? text : text.slice(0, 3000) + ` … (more in ${host.built}/card.json and ${host.data}/card.json)`;
}

export default function (pi: ExtensionAPI) {
  // a removed board (board/) takes its open notes with it; a note its agent hasn't seen yet is just taken back
  pi.on("session_start", () => host.api.board?.onRemove("note", (n: number) => {
    const gone: { owner: string; what: string }[] = [];
    for (const id of Object.keys(notes.open).filter((id) => (notes.open[id].board ?? 1) === n)) {
      const note = notes.open[id], item = items.get(id);
      delete notes.open[id];
      items.delete(id);
      host.broadcast("note_done", { id });
      if (!(item && host.api.team?.withdraw(item))) gone.push({ owner: note.to, what: `note ${id} ("${note.text}")` });
    }
    save();
    return gone;
  }));

  pi.registerTool({
    name: "note_done", label: "Note done", description: "Mark a note the user pinned on the page as dealt with; its pin fades.",
    parameters: Type.Object({ id: Type.String({ description: "e.g. n3" }) }),
    async execute(_id, a) {
      if (!notes.open[a.id]) return { content: [{ type: "text", text: `error: no open note '${a.id}'. Open notes: ${Object.keys(notes.open).join(", ")}` }], details: undefined };
      delete notes.open[a.id];
      items.delete(a.id);
      save();
      host.broadcast("note_done", { id: a.id });
      return { content: [{ type: "text", text: `note ${a.id} is done; its pin fades from the page` }], details: undefined };
    },
  });

  host.routes.set("/note/all", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(notes.open)));

  host.pageHandlers.set("note", (msg: any) => {
    const team = host.api.team;
    if (msg.type === "note_dismiss" && notes.open[msg.id]) {
      const note = notes.open[msg.id];
      delete notes.open[msg.id];
      save();
      host.broadcast("note_done", { id: msg.id });
      const item = items.get(msg.id);
      items.delete(msg.id);
      if (!(item && team?.withdraw(item)))
        team?.send("user", note.to, `[note on the page] the user closed note ${msg.id} ("${note.text}"): drop it if you haven't finished it.`, true);
    }
    if (!["note_add", "note_combine"].includes(msg.type) || !team) return;
    const to = host.agents.has(msg.to) ? msg.to : "agent1";
    const text = msg.text ?? "";
    if (msg.type === "note_combine") {
      const { a, b } = msg;
      const madeFrom = [...(host.shared.get("card")?.cards[b]?.made_from ?? []).filter((m: string) => m !== a), a];
      const id = pin(`combine ${a} into ${b}: ${text}`, to, msg);
      return items.set(id, team.send("user", to, [`[combine on the page] ${text}`, `  id: ${id} (call note_done("${id}") when dealt with)`,
        `  board: ${notes.open[id].board}`,
        `  dragged: ${a} (keep it as it is)`, `  onto: ${b} (change this one)`,
        `  so: card_show(card="${b}", ..., made_from=${JSON.stringify(madeFrom)}, instruction=<their words>), reading ${a}'s data with {"ref": "${a}", "path": ...}`,
        `  ${a}: ${describe(a)}`, `  ${b}: ${describe(b)}`].join("\n")));
    }
    const t = msg.target ?? {};
    const at = t.at && `${t.at.x} across, ${t.at.y} down the element`;
    const pos = t.position && `x=${t.position.x}, y=${t.position.y} px in the main space (for card_show's place)`;
    const area = t.area && `x=${t.area.x}, y=${t.area.y}, width=${t.area.width}, height=${t.area.height} px in the main space `
      + (t.card ? "(the user drew around this part of the card: the note is about it)" : "(the user drew around empty space: build inside it)");
    const id = pin(text, to, msg);
    const lines = [`[note on the page] ${text}`, `  id: ${id} (call note_done("${id}") when dealt with)`,
      ...([["board", notes.open[id].board], ["card", t.card], ["block", (t.blocks ?? []).join(" → ")], ["element", t.element],
           ["part", t.part && JSON.stringify(t.part)], ["at", at], ["text", t.text], ["file", t.file && path.join(host.home, t.file)], ["position", pos],
           ["area", area], ["files", msg.files?.join(", ")]] as [string, any][]).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`)];
    items.set(id, team.send("user", to, lines.join("\n")));
  });
}
