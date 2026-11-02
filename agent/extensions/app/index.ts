// Apps: pages the agents write in built/apps/<name>/ (the host serves them at /built/apps/<name>/), shown on a card
// (the card extension draws the frame). This extension gives apps what a plain page can't have:
//   - their data, kept on the server: one JSON value per app in data/app/<name>.json, so it outlives the page, is
//     the same in every browser, and the agents can read it. Whole value replaced each time: the last save wins
//     (keep one app's data in one value). The same app on several cards shares it: every save is an "app_data" event;
//   - agents.js, their bridge to the agents (load, save, send, action, reset, on: read its header);
//   - the app-agents skill (apps with agents inside, e.g. a simulation's members).
//   GET /app/data/<name>    the app's data ({} if none yet)        GET /app/agents.js   the bridge
//   PUT /app/data/<name>    replace it (JSON, at most MAX_BYTES); event "app_data" {app, data}
//   page messages  app_message {to, text}: to an agent, from "app" (at most MESSAGES_PER_MINUTE, all apps together)
//                  app_reset {card}: empty the memories of the agents spawned for the app on that card (the team's reset)
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const DIR = path.join(host.data, "app");
const MAX_BYTES = 1024 * 1024;
const MESSAGES_PER_MINUTE = 30;
const sent: number[] = host.shared.get("app-sent") ?? [];  // when apps sent messages (on the host: outlives reloads)
host.shared.set("app-sent", sent);
const json = (res: any, v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({ skillPaths: [path.join(import.meta.dirname, "skills")] }));

  host.routes.set("/app/agents.js", (_req: any, res: any) => host.file(res, path.join(import.meta.dirname, "agents.js")));
  host.routes.set("/app/data/", (req: any, res: any) => {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice("/app/data/".length));
    if (!/^[\w-]+$/.test(name)) return json(res, { error: "app names are letters, digits, _ and -" }, 400);
    const p = path.join(DIR, name + ".json");
    if (req.method === "GET") {
      if (!fs.existsSync(p)) return json(res, {});
      return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(fs.readFileSync(p));
    }
    if (req.method !== "PUT") return res.writeHead(405).end();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
    req.on("end", () => {
      if (size > MAX_BYTES) return json(res, { error: `over ${MAX_BYTES / 1024} KB` }, 400);
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e: any) { return json(res, { error: `not JSON: ${e.message}` }, 400); }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(p + ".tmp", JSON.stringify(data));
      fs.renameSync(p + ".tmp", p);
      host.broadcast("app_data", { app: name, data });
      json(res, { saved: true });
    });
  });

  host.pageHandlers.set("app", async (msg: any) => {
    const team = host.api.team, error = (text: string) => host.broadcast("error", { agent: "app", text });
    if (msg.type === "app_reset" && team) {
      const names = [...host.agents.values()].filter((x: any) => x.app === msg.card).map((x: any) => x.name);
      const problem = await team.reset(names);
      if (problem) error(`reset of ${msg.card}: ${problem}`);
    } else if (msg.type === "app_message" && team) {
      const now = Date.now();
      sent.splice(0, sent.length, ...sent.filter((t) => now - t < 60000));
      if (!host.agents.has(msg.to)) error(`app message to unknown agent '${msg.to}'`);
      else if (sent.length >= MESSAGES_PER_MINUTE) error(`app message to ${msg.to} dropped: more than ${MESSAGES_PER_MINUTE} a minute`);
      else { sent.push(now); team.send("app", msg.to, msg.text ?? ""); }
    }
  });
}
