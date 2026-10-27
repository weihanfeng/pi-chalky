// App data: a small shared store for apps (app/ui/apps/<name>/, shown by the App component), saved here, so an
// app's data outlives the page, is the same in every browser, and the agents can read it (port of the Python
// appdata plugin). One JSON value per app, in state/app-data/<name>.json. The same app shown in several surfaces
// shares it: when one saves, every open page and app frame gets an "app_data" event.
// The app side is app/ui/agents.js: agents.load(), agents.save(data), agents.on("app_data", fn).
//   GET /ui-api/app-data/<name>    the app's data ({} if none yet)
//   PUT /ui-api/app-data/<name>    replace it (JSON, at most MAX_BYTES); event "app_data" {app, data}
// Whole value replaced each time: the last save wins (keep one app's data in one value). A version check (refuse a
// save made from an older value) is the fix if lost saves show up; not added yet.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const DIR = path.join(host.state, "app-data");
const MAX_BYTES = 1024 * 1024;
const json = (res: any, v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "appdata.guide.md"), "utf8")
    .replaceAll("/app/state/", host.state + "/").replaceAll("/app/", host.app + "/");
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.appdata = guide; });

  host.routes.set("/ui-api/app-data/", (req: any, res: any) => {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice("/ui-api/app-data/".length));
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
      if (size > MAX_BYTES) return json(res, { error: `bad app name, or over ${MAX_BYTES / 1024} KB` }, 400);
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e: any) { return json(res, { error: `not JSON: ${e.message}` }, 400); }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(p + ".tmp", JSON.stringify(data));
      fs.renameSync(p + ".tmp", p);
      host.broadcast("app_data", { app: name, data });
      json(res, { saved: true });
    });
  });
}
