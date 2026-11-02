// Every state of the cards, kept: undo, redo and rewind for the user (browser.js: the keys and the bar). After each
// change (the card extension's change() with words for it, from the user or an agent) it saves a step: a full copy
// of all cards, design and data. Steps form a tree: each has a parent, so undoing and then doing something new
// starts a branch and loses nothing; redo follows the newest branch.
//   page messages   history_undo, history_redo, history_goto {step}
//   page event      "history" {event: "moved", at, what} after undo/redo/goto; {event: "branched", tip} a change made after undoing
//   GET /history    {"at", "line": [{"n", "ts", "by", "what"}]}, the current line (root to newest tip)
// Kept in data/history.jsonl (one step per line), for HISTORY_KEEP_DAYS (default 7). Older steps are dropped at
// start and every PRUNE_EVERY steps; the current step is always kept.
// Undo puts back the cards only: agent/ and built/ have their own history (the version extension).
// pi has no undo for this: /tree and /fork rewind one agent's conversation, not the shared page.
// It watches the card extension's changes (host.api.card.watch); others reach it as host.api.history. Not pi.events:
// each agent has its own bus, and a reload keeps the old listeners on it, so every change would be recorded again.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const FILE = path.join(host.data, "history.jsonl");
const KEEP_DAYS = Number(process.env.HISTORY_KEEP_DAYS ?? 7);
const PRUNE_EVERY = 200;

// JSON with every object's keys in order: the same content compares the same (a record loaded from the files has
// "data" last, one just drawn has it in the middle)
const sorted = (v: any) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);

type Step = { n: number, parent: number | null, ts: number, by: string, what: string, cards: Record<string, any> };

class History {
  steps = new Map<number, Step>();
  at: number | null = null;  // the step the cards are at now
  constructor(public cards: any) {
    if (fs.existsSync(FILE))
      for (const line of fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        if ("at" in entry) this.at = entry.at;  // a marker line: where undo/redo left us
        else { this.steps.set(entry.n, entry); this.at = entry.n; }  // a new step is where we are (the Python version
      }                                                                // missed this: after a goto, a restart went back there)
    if (this.at === null || !this.steps.has(this.at)) this.at = this.steps.size ? Math.max(...this.steps.keys()) : null;
    this.prune();
    if (this.at === null || sorted(this.steps.get(this.at)!.cards) !== sorted(cards.cards))
      this.add("start", "the cards as loaded");  // first start, or the files changed while we were away
  }
  write(entry: object) { fs.appendFileSync(FILE, JSON.stringify(entry) + "\n"); }
  add(by: string, what: string) {  // a new step after the current one; tells the pages if it left a branch behind
    const left = this.children(this.at).length ? this.tip(this.at!) : null;
    const n = this.steps.size ? Math.max(...this.steps.keys()) + 1 : 0;
    const step = { n, parent: this.at, ts: Date.now() / 1000, by, what, cards: this.cards.snapshot() };
    this.steps.set(n, step);
    this.at = n;
    this.write(step);
    if (n % PRUNE_EVERY === 0) this.prune();
    if (left !== null) host.broadcast("history", { event: "branched", tip: left });
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
    this.cards.restore(this.steps.get(n)!.cards);
    host.broadcast("history", { event: "moved", at: n, what: this.steps.get(n)!.what });
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
  // made once all of an agent's extensions are loaded (pi loads them in folder order, not by name, so the card
  // extension may come after this file); the first agent's session_start makes it, at startup, before any change
  pi.on("session_start", () => {
    if (!host.shared.has("history")) host.shared.set("history", new History(host.shared.get("card")));
    host.api.history = host.shared.get("history");
    host.api.card?.watch("history", (_id: string, by?: string, what?: string) => { if (what) host.api.history.add(by, what); });
  });
  const shared = (): History | undefined => host.shared.get("history");

  host.pageHandlers.set("history", (msg: any) => {
    const history = shared();
    if (!history) return;
    const now = history.at === null ? undefined : history.steps.get(history.at);
    if (msg.type === "history_undo" && now && now.parent !== null) history.goto(now.parent);
    else if (msg.type === "history_redo") { const kids = history.children(history.at); if (kids.length) history.goto(kids.at(-1)!); }
    else if (msg.type === "history_goto") history.goto(msg.step);
  });
  host.routes.set("/history", (_req: any, res: any) => {
    const history = shared();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ at: history?.at ?? null,
      line: (history?.line() ?? []).map((n) => { const { cards, parent, ...s } = history!.steps.get(n)!; return s; }) }));
  });
}
