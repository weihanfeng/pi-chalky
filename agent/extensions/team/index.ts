// The team: peer-to-peer agents, no manager; anyone (the user or an agent)
// can talk to any agent. Every agent is its own pi session (host.createAgent). A message starts a turn, and the
// turn's final answer goes back to whoever is owed it. Nothing is said "to no one".
//   - Kinds of item:  message  from the user or the harness; the answer is shown in the chat
//                     question team_ask: the asker waits; the answer is its tool result
//                     request  team_tell: the sender goes on; the answer comes back to it as a reply
//                     reply    the answer to a request (or to a question that timed out)
//                     fyi      a team_tell to the agent you owe your answer to: an update, not a request (no answer back)
//   - Each item has a chain: who gets the answer, nearest first. A request from agent1 (working for the user) has
//     chain [agent1, user]; agent2's answer goes to agent1 as a reply with chain [user], and agent1's answer to that
//     reply goes to the user. So replies never bounce back and forth.
//   - Requests, replies and fyis for an agent in the middle of a turn: pi's steer() (it sees them between its tool calls;
//     no turn of their own). An fyi for an idle agent: pi's sendCustomMessage() (filed; the model sees it next turn).
//     Messages and questions wait in the inbox for a turn of their own, one at a time.
//   - Limits: asks + tells per user message, agents, inbox size, requests per minute, identical requests dropped, ask
//     timeout. Asking an agent that is waiting on you is refused (use team_tell).
// Shared state is plain data on the host (host.shared "team"); the code that acts on it is this file's newest load
// (host.api.team), so an edited team/index.ts takes effect after a reload. Agents: host.agents (role, app, session).
// Pictures with a message (doodle's steps): send(..., images) takes png paths; they go to pi with the text (prompt
// or steer), read when the agent gets the message.
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const MAX_MESSAGES = Number(process.env.TEAM_MAX_MESSAGES || 50);  // team_ask + team_tell calls per user message
const MAX_AGENTS = Number(process.env.TEAM_MAX_AGENTS || 8);
const ASK_TIMEOUT = Number(process.env.TEAM_ASK_TIMEOUT || 600);   // seconds; then the answer comes as a reply
const INBOX_CAP = 50;          // items waiting for one agent
const REQUESTS_PER_MINUTE = 20;   // per sender

type Waiter = { resolve: (answer: string) => void } | null;
type Item = { kind: string; sender: string; text: string; chain: string[]; ts: number; waiter: Waiter; images?: string[] };

if (!host.shared.has("team"))
  host.shared.set("team", { inbox: {}, running: new Set(), chain: {}, waiting: {}, doing: {}, sent: 0, recent: {},
                             lastRequest: {} });
const S = host.shared.get("team");
const inbox = (name: string): Item[] => (S.inbox[name] ??= []);
const isAgent = (name: string) => host.agents.has(name);
const target = (chain: string[]) => (chain[0] && isAgent(chain[0]) ? chain[0] : "user");

function header(item: Item, to?: string) {
  let h = `[${item.kind} from ${item.sender} · ${new Date(item.ts).toTimeString().slice(0, 8)}]`;
  if (item.kind === "question") h += " (they are waiting for your answer)";
  if (item.kind === "reply" && to) h += ` (your final answer goes to ${to})`;
  return h;
}

function changed(name?: string, doing?: string) {
  if (name && doing !== undefined) S.doing[name] = [doing, Date.now() / 1000];
  host.broadcast("status", { agents: status() });
}

// png paths -> pi's image content (a file gone since is left out)
const pictures = (paths: string[] = []) => paths.filter((p) => fs.existsSync(p))
  .map((p) => ({ type: "image" as const, data: fs.readFileSync(p).toString("base64"), mimeType: "image/png" }));

function put(to: string, kind: string, sender: string, text: string, chain: string[], waiter: Waiter = null, images?: string[]) {
  const item: Item = { kind, sender, text, chain, ts: Date.now(), waiter, images };
  const session = host.agents.get(to).session;
  if (["request", "reply", "fyi"].includes(kind) && session.isStreaming) void session.steer(`${header(item)}\n${text}`, pictures(images));
  else if (kind === "fyi")  // its turn ended before it was handed over: file it, don't start a turn
    void session.sendCustomMessage({ customType: "inbox", content: `${header(item)}\n${text}`, display: true });
  else {
    inbox(to).push(item);
    if (!S.running.has(to)) void work(to);
  }
  changed();
  return item;
}

// One item -> one turn -> one answer, in order, while the inbox has items
async function work(name: string) {
  S.running.add(name);
  changed(name, "thinking");
  try {
    while (inbox(name).length) {
      const item = inbox(name).shift()!;
      const to = target(item.chain);
      S.chain[name] = item.chain;
      const answer = await host.prompt(name, `${header(item, to)}\n${item.text}`, to, pictures(item.images));
      delete S.chain[name];
      if (item.waiter) item.waiter.resolve(answer);  // a question: the asker is waiting
      else if (to !== "user" && to !== name && answer.trim()) put(to, "reply", name, answer, item.chain.slice(1));
    }
  } finally {
    S.running.delete(name);
    changed(name, "idle");
  }
}

function status() {
  const out: Record<string, any> = {};
  for (const a of host.agents.values()) {
    const [doing, since] = S.doing[a.name] ?? ["idle", Date.now() / 1000];
    const waiting = [...(S.waiting[a.name] ?? [])].sort();
    const busy = S.running.has(a.name);
    out[a.name] = { role: a.role, app: a.app ?? null, state: waiting.length ? `waiting on ${waiting.join(", ")}` : busy ? "working" : "idle",
                    doing: busy ? doing : "", since, queued: inbox(a.name).length };
  }
  return out;
}

const owed = (name: string) => { const c = S.chain[name]; return c?.[0] && isAgent(c[0]) ? c[0] : null; };

function waitsOn(a: string, b: string) {  // is agent a waiting on agent b, directly or through others?
  const seen = new Set<string>(), todo = [a];
  while (todo.length)
    for (const x of S.waiting[todo.pop()!] ?? []) {
      if (x === b) return true;
      if (!seen.has(x)) { seen.add(x); todo.push(x); }
    }
  return false;
}

function ask(asker: string, to: string, text: string, signal?: AbortSignal) {
  (S.waiting[asker] ??= new Set()).add(to);
  changed();
  return new Promise<string>((resolve) => {
    const done = (answer: string) => {
      clearTimeout(timer);
      S.waiting[asker]?.delete(to);
      changed();
      resolve(answer);
    };
    const item = put(to, "question", asker, text, [asker, ...(S.chain[asker] ?? [])], { resolve: done });
    const timer = setTimeout(() => {
      item.waiter = null;  // the answer will come as a reply instead
      done(`error: no answer from ${to} within ${ASK_TIMEOUT} s. It is still working on it; its answer will come to you `
        + "as a reply. Continue with something else.");
    }, ASK_TIMEOUT * 1000);
    signal?.addEventListener("abort", () => { item.waiter = null; done("error: stopped"); });
  });
}

const api = {
  status,
  // From the user or the harness (the page's chat, apps, card actions). The answer is shown in the chat.
  // Returns the item (for withdraw). images: png paths sent with it.
  send(sender: string, to: string, text: string, request = false, images?: string[]) {
    if (sender === "user") S.sent = 0;  // a new user message gives the team a fresh budget
    return put(to, request ? "request" : "message", sender, text, [sender], null, images);
  },
  // An update for an agent that doesn't start a turn (filed if idle, between its tool calls if busy)
  fyi(sender: string, to: string, text: string) { return put(to, "fyi", sender, text, [sender]); },
  // Take back an item that is still waiting in an inbox: true if it was there (its agent never saw it)
  withdraw(item: Item) {
    for (const items of Object.values(S.inbox) as Item[][]) {
      const i = items.indexOf(item);
      if (i >= 0) { items.splice(i, 1); changed(); return true; }
    }
    return false;
  },
  // Drop all queued items and stop every running turn; agents stay, idle
  async stop() {
    for (const name of Object.keys(S.inbox))
      for (const item of S.inbox[name].splice(0)) item.waiter?.resolve(`error: ${name} was stopped before replying`);
    await Promise.all([...host.agents.keys()].map((n: string) => host.abort(n)));
    for (const k of Object.keys(S.waiting)) delete S.waiting[k];
    changed();
    host.broadcast("stopped", { agent: "all" });
  },
  // Empty these agents' memories (roles kept): a new pi session each. An error string, or null when done.
  async reset(names: string[]) {
    const busy = names.filter((n) => S.running.has(n) || S.waiting[n]?.size || inbox(n).length);
    if (busy.length) return `error: ${busy.join(", ")} still working or with messages waiting. Reset when they are idle.`;
    for (const n of names) { const a = host.agents.get(n); await host.createAgent(n, a.role, a.app, true); }
    return null;
  },
};
host.api.team = api;

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

export default function (pi: ExtensionAPI) {
  const me = () => pi.getSessionName()!;
  // What each agent is doing right now, for status
  pi.on("tool_execution_start", (ev) => {
    const args = ev.args ?? {};
    changed(me(), `${ev.toolName} ${String(args.command ?? args.to ?? args.card ?? args.path ?? "").slice(0, 60)}`.trim());
  });
  pi.on("turn_start", () => changed(me(), "thinking"));

  const checkTo = (agent: string, to: string) => {
    if (!isAgent(to)) return `error: no agent '${to}'. Agents: ${[...host.agents.keys()].join(", ")}`;
    if (to === agent) return "error: that is you";
    if (S.sent >= MAX_MESSAGES) return `error: message budget (${MAX_MESSAGES} asks/tells per user message) used up. Finish with what you have.`;
    return null;
  };

  pi.registerTool({
    name: "team_spawn", label: "Team spawn",
    description: "Create a new peer agent with a role. It starts idle. Agents are numbered in creation order (agent1, agent2, ...); "
      + "the result tells you the new name.",
    parameters: Type.Object({
      role: Type.String(),
      name: Type.Optional(Type.String({ description: "Only if the user asked for a specific name. Otherwise leave out." })),
      app: Type.Optional(Type.String({ description: "The card of the app this agent is part of (a simulation's member, a "
        + "character). Leave out for agents that work with you." })),
    }),
    async execute(_id, a) {
      if (a.name && (isAgent(a.name) || a.name === "user")) return result(`error: name '${a.name}' is taken`);
      if (host.agents.size >= MAX_AGENTS) return result(`error: the team is full (${MAX_AGENTS} agents). Give work to an existing agent (team_list).`);
      let name = a.name, n = host.agents.size + 1;
      while (!name || isAgent(name)) name = `agent${n++}`;  // next free number
      await host.createAgent(name, a.role, a.app);
      changed(name, "idle");
      return result(`created agent '${name}'` + (a.app ? `, part of app '${a.app}'` : "") + ". It is idle until someone messages it.");
    },
  });

  pi.registerTool({
    name: "team_reset", label: "Team reset", exposure: "deferred",
    description: "Empty an agent's memory, keeping its role (for a new round that starts fresh). Give a name, or app to reset "
      + "all agents of that app. Only when they are idle.",
    parameters: Type.Object({ name: Type.Optional(Type.String()), app: Type.Optional(Type.String()) }),
    async execute(_id, a) {
      const names = [...host.agents.values()].filter((x: any) => x.name === a.name || (a.app && x.app === a.app)).map((x: any) => x.name);
      if (!names.length) return result(a.name ? `error: no agent '${a.name}'` : `error: no agents in app '${a.app}'`);
      if (names.includes(me())) return result("error: you can't reset yourself");
      const error = await api.reset(names);
      return result(error ?? `reset ${names.join(", ")}: each starts its next turn with an empty memory and the same role.`);
    },
  });

  pi.registerTool({
    name: "team_tell", label: "Team tell",
    description: "Send a request to another agent and keep working (don't wait). Its answer comes back to you later as a reply.",
    parameters: Type.Object({ to: Type.String(), text: Type.String() }),
    async execute(_id, a) {
      const agent = me(), now = Date.now();
      const error = checkTo(agent, a.to);
      if (error) return result(error);
      const recent = (S.recent[agent] ?? []).filter((t: number) => now - t < 60000);
      if (S.lastRequest[`${agent}>${a.to}`] === a.text) return result(`error: dropped, same as your last request to ${a.to}. It already has it.`);
      if (recent.length >= REQUESTS_PER_MINUTE) return result(`error: slow down: at most ${REQUESTS_PER_MINUTE} requests a minute. Wait for replies instead.`);
      if (inbox(a.to).length >= INBOX_CAP) return result(`error: ${a.to}'s inbox is full (${INBOX_CAP}). Wait for it to catch up.`);
      S.recent[agent] = [...recent, now];
      S.lastRequest[`${agent}>${a.to}`] = a.text;
      S.sent++;
      if (owed(agent) === a.to) {  // it's owed your final answer anyway: an update, no answer back
        put(a.to, "fyi", agent, a.text, []);
        return result(`sent as information only: ${a.to} gets your final answer anyway, so don't repeat this there. `
          + `It won't answer this; if you need an answer from ${a.to}, use team_ask.`);
      }
      put(a.to, "request", agent, a.text, [agent, ...(S.chain[agent] ?? [])]);
      return result(`sent. ${a.to} is ${status()[a.to].state}; its answer will come to you as a reply. `
        + "If all you have left is waiting, end your turn: the reply wakes you.");
    },
  });

  pi.registerTool({
    name: "team_ask", label: "Team ask",
    description: "Ask another agent and wait for its answer (the result). For quick questions; use team_tell for longer work. "
      + "Several team_ask calls in one step run in parallel.",
    parameters: Type.Object({ to: Type.String(), text: Type.String() }),
    async execute(_id, a, signal) {
      const agent = me();
      const error = checkTo(agent, a.to);
      if (error) return result(error);
      if (waitsOn(a.to, agent)) return result(`error: '${a.to}' is waiting on you, so it can't answer now. Use team_tell, or answer from what you know.`);
      S.sent++;
      return result(await ask(agent, a.to, a.text, signal));
    },
  });

  pi.registerTool({
    name: "team_list", label: "Team list", description: "List all agents: role, and what each is doing right now.",
    parameters: Type.Object({}),
    async execute() {
      const now = Date.now() / 1000;
      return result(Object.entries(status()).map(([n, s]: any) => `${n} (${s.role}): ${s.state}`
        + (s.doing ? `, doing: ${s.doing} for ${Math.round(now - s.since)} s` : "")
        + (s.queued ? `, ${s.queued} waiting in its inbox` : "")).join("\n"));
    },
  });
}
