// The page the user sees (Python: chat_ui.py), as an extension like the others: agents can change it, and the
// versions extension keeps and rolls back its history.
//   GET /                                  page.html, read fresh on every load (edits show on reload)
//   GET /page/scripts                      the browser parts the page imports: one per extension folder with a browser.js
//   GET /extensions/<name>/browser.js      that file (only browser.js: an extension's other files aren't served)
// An extension's browser.js is its part of the page: its default export gets the page's API (see page.html's header).
// Found by looking in each folder, as pi finds index.ts, so an extension has nothing to register.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const EXTENSIONS = path.dirname(import.meta.dirname);
const browserFile = (name: string) => path.join(EXTENSIONS, name, "browser.js");

export default function (_pi: ExtensionAPI) {
  host.routes.set("/", (_req: any, res: any) =>
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache" }).end(fs.readFileSync(path.join(import.meta.dirname, "page.html"))));
  host.routes.set("/page/scripts", (_req: any, res: any) => {
    const names = fs.readdirSync(EXTENSIONS).filter((n) => fs.existsSync(browserFile(n))).sort();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(names.map((n) => `/extensions/${n}/browser.js`)));
  });
  host.routes.set("/extensions/", (req: any, res: any) => {
    const [, , name, file] = new URL(req.url, "http://x").pathname.split("/");
    if (file !== "browser.js" || !/^[\w-]+$/.test(name ?? "") || !fs.existsSync(browserFile(name))) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" }).end(fs.readFileSync(browserFile(name)));
  });
}
