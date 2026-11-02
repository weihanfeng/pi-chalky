// Boards: the main space is several numbered boards, and everything on it (cards, frames, notes; a doodle's
// steps when sent) has a board number. Numbers are never reused: remove board 2 and the rest stay 1, 3, 4, so "board 3" keeps
// meaning the same board to the user and to every agent. A thing with no number is on board 1.
//   built/board.json     {last: <last number>, boards: [numbers]}: next to card.json, so a rollback
//                        brings back both together (read each time: never stale after one)
// The board the user is looking at is the page's to say (in memory; board 1 until it does). browser.js: the shelf.
// Tool boards(board?): the boards and what is on each, and the board the user is on. Others use host.api.board:
//   list() -> [numbers]   has(n)   add(by?) -> the new number   current() -> the user's board
//   onRemove(name, fn)    remove(n): see below
//   GET /board   {boards, current}      page messages  board_view {board}, board_add, board_remove {board}
//   event "board"   {boards, added, by}: a board was added (by "user": that page goes there); {boards, removed}
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const FILE = path.join(host.built, "board.json");
const read = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 1, boards: [1] });
if (!host.shared.has("board-view")) host.shared.set("board-view", { current: 1 });
const view = host.shared.get("board-view");

host.api.board = {
  list: () => read().boards as number[],
  has: (n: number) => read().boards.includes(n),
  add(by = "agent") {  // by "user": the page that asked goes there
    const saved = read();
    saved.boards.push(++saved.last);
    fs.writeFileSync(FILE, JSON.stringify(saved));
    host.broadcast("board", { boards: saved.boards, added: saved.last, by });
    return saved.last;
  },
  current: () => (read().boards.includes(view.current) ? view.current : read().boards[0]),
  // Removing a board (the user's ✕, after its few seconds of Undo on the page): each extension takes its own things
  // off it (onRemove(name, fn): fn(n) deletes them and returns [{owner, what}], e.g. {owner: "agent2", what:
  // "card prices"}; name: the extension's, so its reload replaces its own). Each agent that owned something gets
  // one fyi (no turn of its own: it reads it on its next one). The last board stays.
  onRemove: (name: string, fn: (n: number) => { owner?: string; what: string }[]) => removers.set(name, fn),
  remove(n: number) {
    const saved = read();
    if (!saved.boards.includes(n) || saved.boards.length === 1) return;
    const gone: { owner?: string; what: string }[] = [];
    for (const [name, fn] of removers) {
      try { gone.push(...fn(n)); }
      catch (e) { host.broadcast("error", { agent: "server", text: `board ${n} removal, ${name}: ${e}` }); }
    }
    saved.boards = saved.boards.filter((b: number) => b !== n);
    fs.writeFileSync(FILE, JSON.stringify(saved));
    host.broadcast("board", { boards: saved.boards, removed: n });
    const byOwner = new Map<string, string[]>();
    for (const g of gone) if (g.owner && host.agents.has(g.owner)) byOwner.set(g.owner, [...(byOwner.get(g.owner) ?? []), g.what]);
    for (const [owner, things] of byOwner)
      host.api.team?.fyi("user", owner, `[board removed] The user removed board ${n}; your ${things.join(", ")} went with it.`);
  },
};
// on the host, so they outlive this file's reloads (as ui's watchers)
const removers: Map<string, (n: number) => { owner?: string; what: string }[]> = host.shared.get("board-removers") ?? new Map();
host.shared.set("board-removers", removers);

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

export default function (pi: ExtensionAPI) {

  pi.registerTool({
    name: "board_list", label: "Board list",
    description: "List the boards, what is on each, and the board the user is on. With a board: that one in detail.",
    parameters: Type.Object({ board: Type.Optional(Type.Number()) }),
    async execute(_id, a) {
      // what has a board: cards (card/), frames not filled yet (frame/), open notes (note/); doodles aren't kept
      const of = (m: any) => Object.entries(m ?? {}) as [string, any][];
      const kinds = (n: number) => [of(host.shared.get("card")?.cards), of(host.shared.get("frame")?.frames), of(host.shared.get("note")?.open)]
        .map((list) => list.filter(([, r]) => (r.board ?? 1) === n));
      const head = `the user is on board ${host.api.board.current()}`;
      if (a.board === undefined)
        return result([head, ...host.api.board.list().map((n: number) => {
          const [s, f, notes] = kinds(n);
          return `${n}  ${[s.map(([id]) => id).join(", "), f.map(([id]) => id).join(", "), notes.map(([id]) => `note ${id}`).join(", ")]
            .filter(Boolean).join(" · ") || "(empty)"}`;
        })].join("\n"));
      if (!host.api.board.has(a.board)) return result(`error: no board ${a.board}. Boards: ${host.api.board.list().join(", ")}`);
      const [s, f, notes] = kinds(a.board);
      return result([head, `board ${a.board}:`,
        ...s.map(([id, r]) => `  card ${id} · by ${r.owner} · place ${JSON.stringify(r.place)}${r.pinned ? " · pinned" : ""}`),
        ...f.map(([id, r]) => `  frame ${id} "${r.text}" · ${r.sent ? `sent to ${r.to}` : "not sent"} · place ${JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height })}`),
        ...notes.map(([id, r]) => `  note ${id} "${r.text}" · to ${r.to}`)].join("\n") + (s.length + f.length + notes.length ? "" : "\n  (empty)"));
    },
  });

  host.routes.set("/board", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ boards: host.api.board.list(), current: host.api.board.current() })));
  host.pageHandlers.set("board", (msg: any) => {
    if (msg.type === "board_view" && host.api.board.has(Number(msg.board))) view.current = Number(msg.board);
    else if (msg.type === "board_add") host.api.board.add("user");
    else if (msg.type === "board_remove") host.api.board.remove(Number(msg.board));
  });
}
