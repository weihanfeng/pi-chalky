// Every state of the UI surfaces, kept: undo, redo and rewind for the user (port of the Python ui_history plugin; the
// browser half, browser.js, is its ui_history.js). After each change (ui.ts's change() with words for it, from the user or
// an agent) it saves a step: a full copy of all surfaces, design and data. Steps form a tree: each has a parent, so
// undoing and then doing something new starts a branch and loses nothing; redo follows the newest branch.
//   Page messages:  ui_undo, ui_redo, ui_goto {step}
//   Server -> page: {"type": "ui_history", "event": "moved", "at", "what"}  after undo/redo/goto
//                   {"type": "ui_history", "event": "branched", "tip"}       a change made after undoing
//   GET /ui-api/history: {"at", "line": [{"n", "ts", "by", "what"}]}, the current line (root to newest tip)
// Kept in state/ui-history.jsonl (one step per line), for HISTORY_KEEP_DAYS (default 7). Older steps are dropped at
// start and every PRUNE_EVERY steps; the current step is always kept.
// Undo puts back the surfaces only: code (components, apps) has its own history (the versions plugin, not ported).
// pi has no undo for this: /tree and /fork rewind one agent's conversation, not the shared page.
// ui/index.ts reaches it as host.api.uiHistory (not pi.events: each agent has its own bus, and a reload keeps the old
// listeners on it, so every change would be recorded again for each reload).
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const FILE = path.join(host.state, "ui-history.jsonl");
const KEEP_DAYS = Number(process.env.HISTORY_KEEP_DAYS ?? 7);
const PRUNE_EVERY = 200;

// JSON with every object's keys in order: the same content compares the same (a record loaded from the files has
// "data" last, one just drawn has it in the middle)
const sorted = (v: any) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);

type Step = { n: number, parent: number | null, ts: number, by: string, what: string, surfaces: Record<string, any> };

class History {
  steps = new Map<number, Step>();
  at: number | null = null;  // the step the surfaces are at now
  constructor(public ui: any) {
    if (fs.existsSync(FILE))
      for (const line of fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        if ("at" in entry) this.at = entry.at;  // a marker line: where undo/redo left us
        else { this.steps.set(entry.n, entry); this.at = entry.n; }  // a new step is where we are (the Python version
      }                                                                // missed this: after a goto, a restart went back there)
    if (this.at === null || !this.steps.has(this.at)) this.at = this.steps.size ? Math.max(...this.steps.keys()) : null;
    this.prune();
    if (this.at === null || sorted(this.steps.get(this.at)!.surfaces) !== sorted(ui.surfaces))
      this.add("start", "the surfaces as loaded");  // first start, or the files changed while we were away
  }
  write(entry: object) { fs.appendFileSync(FILE, JSON.stringify(entry) + "\n"); }
  add(by: string, what: string) {  // a new step after the current one; tells the pages if it left a branch behind
    const left = this.children(this.at).length ? this.tip(this.at!) : null;
    const n = this.steps.size ? Math.max(...this.steps.keys()) + 1 : 0;
    const step = { n, parent: this.at, ts: Date.now() / 1000, by, what, surfaces: this.ui.snapshot() };
    this.steps.set(n, step);
    this.at = n;
    this.write(step);
    if (n % PRUNE_EVERY === 0) this.prune();
    if (left !== null) host.broadcast("ui_history", { event: "branched", tip: left });
  }
  children(n: number | null) { return [...this.steps.values()].filter((s) => s.parent === n).map((s) => s.n).sort((a, b) => a - b); }
  tip(n: number) {  // follow the newest child down to the end of the line
    for (let kids = this.children(n); kids.length; kids = this.children(n)) n = kids.at(-1)!;
    return n;
  }
  line() {  // the steps from the oldest kept one to the tip of the current branch
    const back = [];
    for (let n = this.at; n !== null && this.steps.has(n); n = this.steps.get(n)!.parent) back.push(n);
    const ahead = [];
    for (let n = this.at, kids = this.children(n); kids.length; kids = this.children(n)) { n = kids.at(-1)!; ahead.push(n); }
    return [...back.reverse(), ...ahead];
  }
  goto(n: number) {
    if (!this.steps.has(n) || n === this.at) return;
    this.at = n;
    this.write({ at: n });
    this.ui.restore(this.steps.get(n)!.surfaces);
    host.broadcast("ui_history", { event: "moved", at: n, what: this.steps.get(n)!.what });
  }
  prune() {  // drop steps older than KEEP_DAYS (never the current one), then rewrite the file
    const cutoff = Date.now() / 1000 - KEEP_DAYS * 86400;
    for (const [n, s] of this.steps) if (s.ts < cutoff && n !== this.at) this.steps.delete(n);
    for (const s of this.steps.values()) if (s.parent !== null && !this.steps.has(s.parent)) s.parent = null;
    const lines = [...this.steps.values()].sort((a, b) => a.n - b.n).map((s) => JSON.stringify(s));
    if (this.at !== null) lines.push(JSON.stringify({ at: this.at }));
    fs.writeFileSync(FILE + ".tmp", lines.map((l) => l + "\n").join(""));
    fs.renameSync(FILE + ".tmp", FILE);
  }
}

export default function (pi: ExtensionAPI) {
  // made once all of an agent's extensions are loaded (pi loads them in folder order, not by name, so ui and its
  // surfaces may come after this file); the first agent's session_start makes it, at startup, before any change
  pi.on("session_start", () => {
    if (!host.shared.has("ui-history")) host.shared.set("ui-history", new History(host.shared.get("ui")));
    host.api.uiHistory = host.shared.get("ui-history");
  });
  const shared = (): History | undefined => host.shared.get("ui-history");

  host.pageHandlers.set("ui_history", (msg: any) => {
    const history = shared();
    if (!history) return;
    const now = history.at === null ? undefined : history.steps.get(history.at);
    if (msg.type === "ui_undo" && now && now.parent !== null) history.goto(now.parent);
    else if (msg.type === "ui_redo") { const kids = history.children(history.at); if (kids.length) history.goto(kids.at(-1)!); }
    else if (msg.type === "ui_goto") history.goto(msg.step);
  });
  host.routes.set("/ui-api/history", (_req: any, res: any) => {
    const history = shared();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ at: history?.at ?? null,
      line: (history?.line() ?? []).map((n) => { const { surfaces, parent, ...s } = history!.steps.get(n)!; return s; }) }));
  });
}
