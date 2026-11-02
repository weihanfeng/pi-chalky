// Screen: what the user sees, as pictures. The
// browser half shares the tab once (for every extension: doodle's steps, an agent's look) and uploads pictures
// cropped from it. This half keeps them and gives agents the tool screen_see: the user's window as it is now
// (their size, scroll, panels, running apps; browser-check's headless Chrome is a fresh window of its own).
//   POST /screen/shot       a png (at most MAX_BYTES): saved in data/screen, {path} back
//   event "screen_ask"      {id, agent} to every open page, when an agent calls screen_see
//   page message            screen_reply {id, shot, window: {width, height}, main: {x, y}}: the first answers
//                           (shot null: the user said no; main: window (0, 0) in main-space px)
//   event "screen_ask_done" {id} to every page when answered or after ASK_WAIT s, so the asks go away
//   host.api.screen         isShot(path): whether a path is a picture saved here (others attach pictures by path)
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const SHOTS = path.join(host.data, "screen");
const MAX_BYTES = 8 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ASK_WAIT = 90;  // s for the user to answer screen_see

const isShot = (p: unknown) => typeof p === "string" && path.dirname(p) === SHOTS && fs.existsSync(p);
host.api.screen = { isShot };
// id -> resolve, while screen_see waits for a page (on the host: the tool is per agent, the page handler one)
const asks: Map<string, (msg: any) => void> = host.shared.get("screen-asks") ?? new Map();
host.shared.set("screen-asks", asks);

host.routes.set("/screen/shot", (req: any, res: any) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
  req.on("end", () => {
    const png = Buffer.concat(chunks);
    if (size > MAX_BYTES || !png.subarray(0, 8).equals(PNG))
      return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `a png of at most ${MAX_BYTES / 2 ** 20} MB` }));
    fs.mkdirSync(SHOTS, { recursive: true });
    const p = path.join(SHOTS, `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${process.hrtime.bigint() % 1000000n}.png`);
    fs.writeFileSync(p, png);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: p }));
  });
});

host.pageHandlers.set("screen", (msg: any) => {
  if (msg.type === "screen_reply") asks.get(msg.id)?.(msg);
});

const result = (text: string, png?: string) => ({ details: undefined, content: [{ type: "text" as const, text },
  ...(png ? [{ type: "image" as const, data: fs.readFileSync(png).toString("base64"), mimeType: "image/png" }] : [])] });

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "screen_see", label: "Screen see",
    description: "See the user's screen as they see it right now: a picture of their whole window (their size, scroll, "
      + "open panels, apps as they are running). browser-check's headless Chrome is a fresh window of its own, not theirs: when "
      + "the user talks about what they see, or before you say something looks right to them, look here. The first "
      + "time, the user is asked to share the tab (they may say no); then it's instant.",
    parameters: Type.Object({}),
    async execute(_id, _args, signal) {
      const id = `${pi.getSessionName()}-${Date.now()}`;
      const reply: any = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ASK_WAIT * 1000);
        const done = (msg: any) => { clearTimeout(timer); resolve(msg); };
        asks.set(id, done);
        signal?.addEventListener("abort", () => done(null));
        host.broadcast("screen_ask", { id, agent: pi.getSessionName() });
      });
      asks.delete(id);
      host.broadcast("screen_ask_done", { id });
      if (!reply) return result(`no answer within ${ASK_WAIT} s (the page may not be open, or the user is away): ask them what they see`);
      if (!isShot(reply.shot)) return result("the user didn't share their screen: ask them what they see");
      const png = fs.readFileSync(reply.shot), pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);  // the png's own size (IHDR)
      const w = reply.window ?? {}, m = reply.main ?? {}, k = w.width ? pw / w.width : 1;
      const mx = Math.round(m.x ?? 0), my = Math.round(m.y ?? 0);
      return result(`the user's screen right now: their window is ${w.width}x${w.height} px; the picture is the whole window, `
        + `${pw}x${ph} px (${+k.toFixed(3)} picture px per window px). Window (0, 0) is main-space (${mx}, ${my}): a spot in `
        + `the picture is main-space x = ${mx} + picture x / ${+k.toFixed(3)}, the same for y (what card_show's place uses).`, reply.shot);
    },
  });
}
