// Files: the user's files, in one folder, workspace/drops (the browser half,
// browser.js, is its files.js). browser.js shows them in a panel on the page's right edge and handles files dragged onto
// the page (from the computer: uploaded here, listed, and a "file-dropped" DOM event so note's browser.js opens its note
// box there; onto the panel itself: only stored; a row from the panel: the same event with that file).
// The agent always knows the folder (its prompt section); files it saves there show in the panel too (the list is
// sent again after each of its tool calls, pi's tool_execution_end, if it changed: a file it saves shows at once,
// while it is still working).
//   POST /file/upload?name=<file name>  the file's bytes: saved in DIR (a safe, new name), returns {path, size}
//   GET  /file                           [{name, path, size}], newest first; files in folders too ("q3/costs.xlsx")
//   POST /file/delete                   {names: [...]} (names as listed): deleted for good, returns {deleted, errors}
//   event "file" {files: [...]}         to every open page, when the list changed
// guide.md (short enough to be whole) names pi's read tool for pictures.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const DIR = path.join(host.workspace, "drops");
const MAX_FILE = 25 * 1024 * 1024;  // bytes per uploaded file
const MAX_LISTED = 500;             // rows in the panel (the newest)
fs.mkdirSync(DIR, { recursive: true });  // there from the first turn, so the agent can save into it

function listing() {  // the files in DIR and its folders (not hidden ones), newest first; name: the path inside DIR
  return fs.readdirSync(DIR, { withFileTypes: true, recursive: true })
    .map((e) => ({ e, name: path.relative(DIR, path.join(e.parentPath, e.name)) }))
    .filter(({ e, name }) => e.isFile() && !name.split(path.sep).some((s) => s.startsWith(".")))
    .map(({ name }) => { const p = path.join(DIR, name), st = fs.statSync(p); return { name, path: p, size: st.size, mtime: st.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
    .slice(0, MAX_LISTED)
    .map(({ name, path, size }) => ({ name, path, size }));
}

function changed(always = false) {  // tell the pages, if the list is not what they were last sent (or always)
  const now = JSON.stringify(listing());
  if (now === host.shared.get("file-last") && !always) return;
  host.shared.set("file-last", now);
  host.broadcast("file", { files: JSON.parse(now) });
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_execution_end", () => changed());  // the agent may have saved files there
  if (!host.shared.has("file-last")) host.shared.set("file-last", JSON.stringify(listing()));

  host.routes.set("/file", (_req: any, res: any) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(listing())));
  host.routes.set("/file/delete", (req: any, res: any) => {  // delete files in DIR; a name may not lead outside it
    if (req.method !== "POST") return res.writeHead(405).end();
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk; });
    req.on("end", () => {
      const deleted: string[] = [], errors: string[] = [];
      let names: string[] = [];
      try { names = JSON.parse(body).names ?? []; } catch {}
      for (const name of names) {
        const p = path.resolve(DIR, String(name));
        if (!p.startsWith(DIR + path.sep)) { errors.push(`${name}: not in the files folder`); continue; }
        if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile()) { errors.push(`${name}: no such file`); continue; }
        fs.rmSync(p);
        deleted.push(name);
      }
      changed(true);  // always: files added outside the panel may have made the last list sent stale
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ deleted, errors }));
    });
  });
  host.routes.set("/file/upload", (req: any, res: any) => {  // save one file in DIR (a new name if it exists)
    if (req.method !== "POST") return res.writeHead(405).end();
    const given = path.basename(new URL(req.url, "http://x").searchParams.get("name") ?? "file");
    const name = given.replace(/[^\w.\-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "file";
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let p = path.join(DIR, name), k = 1;
    while (fs.existsSync(p)) p = path.join(DIR, `${stem}-${++k}${ext}`);
    const out = fs.createWriteStream(p);
    out.on("error", () => {});  // writes still queued when the size limit cuts it off
    let size = 0, tooBig = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FILE && !tooBig) {
        tooBig = true;
        out.on("close", () => fs.rmSync(p, { force: true }));
        out.destroy();
        res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: `${name} is over ${MAX_FILE / 1024 / 1024} MB` }));
        req.destroy();
      } else if (!tooBig) out.write(chunk);
    });
    req.on("end", () => {
      if (tooBig) return;
      out.end(() => {
        changed();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: p, size }));
      });
    });
  });
}
