// Frames: wireframes the user lays out for the agents to fill. browser.js adds a tool to the palette: drag boxes on the main space, type in each what goes there,
// then press Implement. All the frames go together, as one message, to the agent picked in the chat (else agent1),
// so it sees the whole layout and decides how to split the work (alone, or with helpers: README.md, not code).
// A frame is {x, y, width, height, text, sent, to?, board} (main-space px, where card_show's place puts a card;
// board: the one it was drawn on, board/; Implement sends the frames of the board shown), with an
// id (frame-1, frame-2, ...: never reused). An agent fills it with card_show(card="frame-1", place=<its place>);
// when that card appears (a card watcher, host.api.card.watch), the frame is done and its dashed box goes. The user
// can remove a frame (its ✕); if it was sent, its agent is told. Until a frame is sent, its corner resizes it.
//   GET /frame              {id: frame}
//   page messages           frame_add {x, y, width, height, board}, frame_place {id, x, y, width, height}, frame_text {id, text},
//                           frame_remove {id}, frame_send {to, board}
//   event "frame"           {frames: {id: frame}} to every open page, when they changed
// Saved in data/frame.json as {last: <last id number>, frames: {id: frame}}; shared by every agent (host.shared).
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const FILE = path.join(host.data, "frame.json");
if (!host.shared.has("frame"))
  host.shared.set("frame", fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 0, frames: {} });
const saved = host.shared.get("frame");  // {last, frames}
const frames: Record<string, any> = saved.frames;

function changed() {
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(saved));
  fs.renameSync(FILE + ".tmp", FILE);
  host.broadcast("frame", { frames });
}
const box = (msg: any, f: any = {}) => Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, Math.round(Number(msg[k] ?? f[k] ?? 0))]));
const place = (f: any) => JSON.stringify({ x: f.x, y: f.y, width: f.width, height: f.height });

export default function (pi: ExtensionAPI) {

  // a frame is done when a card with its id appears (after all extensions loaded: the card one may come later)
  pi.on("session_start", () => {
    host.api.card?.watch("frame", (sid: string) => {
      if (frames[sid] && host.shared.get("card")?.cards[sid]) { delete frames[sid]; changed(); }
    });
    host.api.board?.onRemove("frame", (n: number) => {  // a removed board (board/) takes its frames with it
      const ids = Object.keys(frames).filter((id) => (frames[id].board ?? 1) === n);
      const gone = ids.map((id) => ({ owner: frames[id].sent ? frames[id].to : undefined, what: `frame ${id}` }));
      for (const id of ids) delete frames[id];
      if (ids.length) changed();
      return gone;
    });
  });

  host.routes.set("/frame", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(frames)));

  host.pageHandlers.set("frame", (msg: any) => {
    const f = frames[msg.id], team = host.api.team;
    if (msg.type === "frame_add") {
      frames[`frame-${++saved.last}`] = { ...box(msg), text: "", sent: false, board: Number(msg.board) || 1 };
      changed();
    } else if (msg.type === "frame_place" && f && !f.sent) {
      Object.assign(f, box(msg, f));
      changed();
    } else if (msg.type === "frame_text" && f && !f.sent) {
      f.text = String(msg.text ?? "");
      changed();
    } else if (msg.type === "frame_remove" && f) {
      delete frames[msg.id];
      changed();
      if (f.sent) team?.send("user", f.to, `[frames on the page] the user removed ${msg.id} ("${f.text}"): don't fill it.`, true);
    } else if (msg.type === "frame_send" && team) {
      const to = msg.to in team.status() ? msg.to : "agent1";
      const board = Number(msg.board) || 1;  // the board shown: its frames only (the user sees no others)
      const ready = Object.entries(frames).filter(([, f]: any) => !f.sent && f.text.trim() && (f.board ?? 1) === board);
      if (!ready.length) return;
      for (const [, f] of ready as any) Object.assign(f, { sent: true, to });
      changed();
      const lines = [`[frames on the page] the user laid out ${ready.length} frame${ready.length > 1 ? "s" : ""} on board ${board} to fill:`,
        ...ready.map(([id, f]: any) => `  ${id}: "${f.text}" · place=${place(f)}`),
        `  Fill each with card_show(card=<its id>, place=<its place>, board=${board}, ...); its dashed box goes when it appears.`];
      const waiting = Object.keys(frames).filter((id) => frames[id].sent && !ready.some(([r]) => r === id));
      if (waiting.length) lines.push(`  Sent before and not filled yet: ${waiting.join(", ")}.`);
      team.send("user", to, lines.join("\n"));
    }
  });
}
