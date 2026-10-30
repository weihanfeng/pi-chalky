// Boards: the main space is several numbered boards, and everything on it (surfaces, frames, notes; a doodle's
// steps when sent) has a board number. Numbers are never reused: remove board 2 and the rest stay 1, 3, 4, so "board 3" keeps
// meaning the same board to the user and to every agent. A thing with no number is on board 1.
//   app/ui/boards.json   {last: <last number>, boards: [numbers]}: next to surfaces.json, so a rollback of the code
//                        brings back both together (read each time: never stale after one)
// The board the user is looking at is the page's to say (in memory; board 1 until it does). browser.js: the shelf.
// Tool boards(board?): the boards and what is on each, and the board the user is on. Others use host.api.boards:
//   list() -> [numbers]   has(n)   add(by?) -> the new number   current() -> the user's board
//   GET /boards  {boards, current}      page messages  board_view {board}, board_add
//   event "boards"  {boards, added, by}: a board was added (by "user": that page goes there)
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const FILE = path.join(host.app, "ui/boards.json");
const read = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 1, boards: [1] });
if (!host.shared.has("board-view")) host.shared.set("board-view", { current: 1 });
const view = host.shared.get("board-view");

host.api.boards = {
  list: () => read().boards as number[],
  has: (n: number) => read().boards.includes(n),
  add(by = "agent") {  // by "user": the page that asked goes there
    const saved = read();
    saved.boards.push(++saved.last);
    fs.writeFileSync(FILE, JSON.stringify(saved));
    host.broadcast("boards", { boards: saved.boards, added: saved.last, by });
    return saved.last;
  },
  current: () => (read().boards.includes(view.current) ? view.current : read().boards[0]),
};

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "guide.md"), "utf8");
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.boards = guide; });

  pi.registerTool({
    name: "boards", label: "Boards",
    description: "List the boards, what is on each, and the board the user is on. With a board: that one in detail.",
    parameters: Type.Object({ board: Type.Optional(Type.Number()) }),
    async execute(_id, a) {
      // what has a board: surfaces (ui/), frames not filled yet (frames/), open notes (point/); doodles aren't kept
      const of = (m: any) => Object.entries(m ?? {}) as [string, any][];
      const kinds = (n: number) => [of(host.shared.get("ui")?.surfaces), of(host.shared.get("frames")?.frames), of(host.shared.get("point")?.open)]
        .map((list) => list.filter(([, r]) => (r.board ?? 1) === n));
      const head = `the user is on board ${host.api.boards.current()}`;
      if (a.board === undefined)
        return result([head, ...host.api.boards.list().map((n: number) => {
          const [s, f, notes] = kinds(n);
          return `${n}  ${[s.map(([id]) => id).join(", "), f.map(([id]) => id).join(", "), notes.map(([id]) => `note ${id}`).join(", ")]
            .filter(Boolean).join(" · ") || "(empty)"}`;
        })].join("\n"));
      if (!host.api.boards.has(a.board)) return result(`error: no board ${a.board}. Boards: ${host.api.boards.list().join(", ")}`);
      const [s, f, notes] = kinds(a.board);
      return result([head, `board ${a.board}:`,
        ...s.map(([id, r]) => `  surface ${id} · by ${r.owner} · place ${JSON.stringify(r.place)}${r.pinned ? " · pinned" : ""}`),
        ...f.map(([id, r]) => `  frame ${id} "${r.text}" · ${r.sent ? `sent to ${r.to}` : "not sent"} · place ${JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height })}`),
        ...notes.map(([id, r]) => `  note ${id} "${r.text}" · to ${r.to}`)].join("\n") + (s.length + f.length + notes.length ? "" : "\n  (empty)"));
    },
  });

  host.routes.set("/boards", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ boards: host.api.boards.list(), current: host.api.boards.current() })));
  host.pageHandlers.set("boards", (msg: any) => {
    if (msg.type === "board_view" && host.api.boards.has(Number(msg.board))) view.current = Number(msg.board);
    else if (msg.type === "board_add") host.api.boards.add("user");
  });
}
