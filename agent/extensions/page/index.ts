// The page the user sees, as an extension like the others: agents can change it, and the
// versions extension keeps and rolls back its history.
//   GET /                                  page.html, read fresh on every load (edits show on reload)
//   GET /page/scripts                      the browser parts the page imports: one per extension folder with a browser.js
//   GET /extensions/<name>/browser.js      that file (only browser.js: an extension's other files aren't served)
// An extension's browser.js is its part of the page: its default export gets the page's API (see page.html's header).
// Found by looking in each folder, as pi finds index.ts, so an extension has nothing to register.
// The conversation on the page: pi's messages in the page's format (OpenAI chat, as the Python harness stored them).
//   event "message"  {agent, role, content, ...} as an agent's pi session ends each message (host.eventHandlers)
//   events "run_start", "run_end", "compacted"  an agent's run started, ended (settled), its context was compacted
//   on opening, a page gets every agent's record, in time order (host.connectHandlers): all its session files
//   (compaction keeps the original entries, so the page still shows everything)
// "joined" (an agent's first system message) and reply_to (who a turn's answer goes to: the host's "chalky.turn"
// entry just before the user message that starts it) are read from the session, so nothing is kept here.
// Running code in the user's open page (browser.js here runs it):
//   tool page_run {code, card?}            JavaScript in the page the user has open, or inside a card's app: its value back
//   POST /page/run {code, card?, agent?}   the same from bash (curl): {value?, error?, errors}
//   event "page_run" {req, tab, card, code, agent}   to every page; only the tab named runs it
//   page message page_tab {tab}            this tab is the one the user looks at (on load and on focus)
//   page message page_ran {req, value?, error?, errors: [str]}
//   page message page_stop {agent}         the bar shown while an agent uses the page: Stop (that agent only)
// The code gets helpers that act as a person would, slowly enough for the user to watch (browser.js's header).
import fs from "node:fs";
import path from "node:path";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const EXTENSIONS = path.dirname(import.meta.dirname);
const browserFile = (name: string) => path.join(EXTENSIONS, name, "browser.js");
const RUN_WAIT = 60;  // s for the page to answer a page_run
// req -> resolve, while page_run waits (on the host: each agent loads this file, the page handler is one); the tab to run in
const runs: Map<string, (msg: any) => void> = host.shared.get("page-runs") ?? new Map();
host.shared.set("page-runs", runs);

host.pageHandlers.set("page", (msg: any) => {
  if (msg.type === "page_tab") host.shared.set("page-tab", msg.tab);
  else if (msg.type === "page_ran") runs.get(msg.req)?.(msg);
  else if (msg.type === "page_stop" && host.agents.has(msg.agent)) host.abort(msg.agent);  // the bar's Stop: that agent only
});

function runInPage(code: string, card: string | undefined, agent: string, signal?: AbortSignal): Promise<any> {
  const req = `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, tab = host.shared.get("page-tab");
  if (!tab) return Promise.resolve({ error: "no page is open: ask the user to open Chalky" });
  return new Promise((resolve) => {
    const done = ({ value, error, errors }: any) => { clearTimeout(timer); runs.delete(req); resolve({ value, error, errors }); };
    const timer = setTimeout(() => done({ error: `no answer within ${RUN_WAIT} s: the page may be closed, or the code still running` }), RUN_WAIT * 1000);
    runs.set(req, done);
    signal?.addEventListener("abort", () => done({ error: "stopped" }));
    host.broadcast("page_run", { req, tab, card, code, agent });
  });
}

const said = (r: any) => (r.error ? `error: ${r.error}` : r.value)
  + (r.errors?.length ? `\nerrors in the page while it ran:\n${r.errors.join("\n")}` : "");

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({ skillPaths: [path.join(import.meta.dirname, "skills")] }));  // interact-with-page
  pi.registerTool({
    name: "page_run", label: "Page run", exposure: "deferred",
    description: "Run JavaScript in the page the user has open, as it is right now, and get its value back. With card=<id>, "
      + "it runs inside that card's app (document is the app's page); without it, in Chalky's page itself. The code is the "
      + "body of an async function: use await, and return what you want back (an element comes back as a short description, "
      + "long values are cut). Errors the page logs while it runs come back too. It is the user's live page: what you click "
      + "really happens, and they watch it. Helpers act as a person would, with your pointer moving there first: "
      + "await click(t), await type(t, text), await press(key, t?), await drag(t, dx, dy), read(t?) (what's on screen, "
      + "as short lines), await wait(ms | selector | fn); t is an element, a CSS selector or its visible text. "
      + "For acting, use the helpers: a bare el.click() happens at once, and the user only sees an outline afterwards. "
      + "If the user clicks or types on the page, they have taken over: stop and wait for their message.",
    parameters: Type.Object({
      code: Type.String({ description: "the body of an async function, e.g. return document.querySelector('h1').innerText" }),
      card: Type.Optional(Type.String({ description: "a card showing an app: run inside that app" })),
    }),
    async execute(_id, args: any, signal) {
      const r = await runInPage(args.code, args.card, pi.getSessionName(), signal);
      return { details: undefined, content: [{ type: "text" as const, text: said(r) }] };
    },
  });

  host.routes.set("/page/run", (req: any, res: any) => {
    if (req.method !== "POST") return res.writeHead(405).end();
    let body = "";
    req.on("data", (c: Buffer) => { body += c; });
    req.on("end", async () => {
      let a: any;
      try { a = JSON.parse(body); } catch { a = null; }
      const r = typeof a?.code !== "string" ? { error: 'send JSON {"code": "...", "card": "<id>"}' }
        : await runInPage(a.code, a.card, a.agent ?? "agent1");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r));
    });
  });
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

const text = (content: any) => typeof content === "string" ? content
  : content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");

// pi message -> the page's message. first: the agent's first system message, shown as "<agent> joined".
// replyTo: on the message that starts a turn, who its answer goes to (not on items slipped into a running turn).
function toPage(m: any, first = false, replyTo?: string) {
  const ts = (m.timestamp ?? Date.now()) / 1000;
  if (m.role === "system") return first ? { role: "system", content: "", ts } : null;
  if (m.role === "user" || (m.role === "custom" && m.customType === "inbox")) {  // inbox: team items filed without a turn
    return { role: "user", content: text(m.content), ...(replyTo && { reply_to: replyTo }), ts };
  }
  if (m.role === "assistant") {
    const calls = m.content.filter((p: any) => p.type === "toolCall")
      .map((p: any) => ({ id: p.id, type: "function", function: { name: p.name, arguments: JSON.stringify(p.arguments) } }));
    const reasoning = m.content.filter((p: any) => p.type === "thinking").map((p: any) => p.thinking).join("\n");
    return { role: "assistant", content: text(m.content), ...(reasoning && { reasoning }), ...(calls.length && { tool_calls: calls }),
             ...(m.errorMessage && { content: `error: ${m.errorMessage}` }), ts };
  }
  if (m.role === "toolResult")
    return { role: "tool", tool_call_id: m.toolCallId, content: (m.isError ? "error: " : "") + text(m.content), ts };
  return null;  // pi's own kinds (custom, compaction summary, ...): not shown
}

// Every message of an agent, from all its session files (older rounds first), in the page's format
function record(name: string) {
  const sm = host.agents.get(name).session.sessionManager, current = sm.getSessionFile(), dir = path.dirname(current);
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().flatMap((f) => {
    const p = path.join(dir, f);
    const entries = p === current ? sm.getEntries() : SessionManager.open(p, dir).getEntries();
    let joined = false, replyTo: string | undefined;
    return entries.flatMap((e: any) => {
      if (e.type === "custom" && e.customType === "chalky.turn") replyTo = e.data.reply_to;
      const msg = e.type === "message" ? e.message : e.type === "custom_message" ? { ...e, role: "custom", timestamp: Date.parse(e.timestamp) } : null;
      if (!msg) return [];
      const m = toPage(msg, !joined && msg.role === "system", msg.role === "user" ? replyTo : undefined);
      if (msg.role === "system") joined = true;
      if (msg.role === "user") replyTo = undefined;
      return m ? [{ agent: name, ...m }] : [];
    });
  });
}

// pi saves a message after its message_end, so the session holds what came before it
host.eventHandlers.set("page", (name: string, ev: any) => {
  if (ev.type === "message_end") {
    const entries = host.agents.get(name)?.session.sessionManager.getEntries() ?? [];
    const first = ev.message.role === "system" && !entries.some((e: any) => e.type === "message" && e.message.role === "system");
    const last = entries.findLast((e: any) => !(e.type === "message" && e.message.role === "system"));  // pi may put a prompt update between
    const replyTo = ev.message.role === "user" && last?.type === "custom" && last.customType === "chalky.turn" ? last.data.reply_to : undefined;
    const m = toPage(ev.message, first, replyTo);
    if (m) host.broadcast("message", { agent: name, ...m });
  } else if (ev.type === "agent_start") host.broadcast("run_start", { agent: name });
  else if (ev.type === "agent_settled") host.broadcast("run_end", { agent: name });
  else if (ev.type === "compaction_end" && ev.result)
    host.broadcast("compacted", { agent: name, tokens_before: ev.result.tokensBefore, tokens_after: ev.result.estimatedTokensAfter ?? "?" });
});

host.connectHandlers.set("page", (send: (type: string, data: object) => void) => {
  for (const m of [...host.agents.keys()].flatMap(record).sort((x: any, y: any) => x.ts - y.ts)) send("message", m);
});
