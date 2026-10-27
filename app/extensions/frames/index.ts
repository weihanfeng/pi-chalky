// Frames: wireframes the user lays out for the agents to fill (port of the Python frames plugin; browser.js is its
// frames.js). browser.js adds a tool to the palette: drag boxes on the main space, type in each what goes there,
// then press Implement. All the frames go together, as one message, to the agent picked in the chat (else agent1),
// so it sees the whole layout and decides how to split the work (alone, or with helpers: guide.md, not code).
// A frame is {x, y, width, height, text, sent, to?} (main-space px, where ui_render's place puts a surface), with an
// id (frame-1, frame-2, ...: never reused). An agent fills it with ui_render(surface="frame-1", place=<its place>);
// when that surface appears (a ui watcher, host.api.ui.watch), the frame is done and its dashed box goes. The user
// can remove a frame (its ✕); if it was sent, its agent is told. Until a frame is sent, its corner resizes it.
//   GET /frames             {id: frame}
//   page messages           frame_add {x, y, width, height}, frame_place {id, x, y, width, height}, frame_text {id, text},
//                           frame_remove {id}, frames_send {to}
//   event "frames"          {frames: {id: frame}} to every open page, when they changed
// Saved in state/frames.json as {last: <last id number>, frames: {id: frame}}; shared by every agent (host.shared).
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const FILE = path.join(host.state, "frames.json");
if (!host.shared.has("frames"))
  host.shared.set("frames", fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 0, frames: {} });
const saved = host.shared.get("frames");  // {last, frames}
const frames: Record<string, any> = saved.frames;

function changed() {
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(saved));
  fs.renameSync(FILE + ".tmp", FILE);
  host.broadcast("frames", { frames });
}
const box = (msg: any, f: any = {}) => Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, Math.round(Number(msg[k] ?? f[k] ?? 0))]));
const place = (f: any) => JSON.stringify({ x: f.x, y: f.y, width: f.width, height: f.height });

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "guide.md"), "utf8").replaceAll("/app/", host.app + "/");
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.frames = guide; });

  // a frame is done when a surface with its id appears (after all extensions loaded: the ui one may come later)
  pi.on("session_start", () => {
    host.api.ui?.watch("frames", (sid: string) => {
      if (frames[sid] && host.shared.get("ui")?.surfaces[sid]) { delete frames[sid]; changed(); }
    });
  });

  host.routes.set("/frames", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(frames)));

  host.pageHandlers.set("frames", (msg: any) => {
    const f = frames[msg.id], swarm = host.api.swarm;
    if (msg.type === "frame_add") {
      frames[`frame-${++saved.last}`] = { ...box(msg), text: "", sent: false };
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
      if (f.sent) swarm?.send("user", f.to, `[frames on the UI] the user removed ${msg.id} ("${f.text}"): don't fill it.`, true);
    } else if (msg.type === "frames_send" && swarm) {
      const to = msg.to in swarm.status() ? msg.to : "agent1";
      const ready = Object.entries(frames).filter(([, f]: any) => !f.sent && f.text.trim());
      if (!ready.length) return;
      for (const [, f] of ready as any) Object.assign(f, { sent: true, to });
      changed();
      const lines = [`[frames on the UI] the user laid out ${ready.length} frame${ready.length > 1 ? "s" : ""} to fill:`,
        ...ready.map(([id, f]: any) => `  ${id}: "${f.text}" · place=${place(f)}`),
        "  Fill each with ui_render(surface=<its id>, place=<its place>, ...); its dashed box goes when it appears."];
      const waiting = Object.keys(frames).filter((id) => frames[id].sent && !ready.some(([r]) => r === id));
      if (waiting.length) lines.push(`  Sent before and not filled yet: ${waiting.join(", ")}.`);
      swarm.send("user", to, lines.join("\n"));
    }
  });
}
