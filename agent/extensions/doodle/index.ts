// Doodle: draw on the page, click through it, and send the whole sequence to an agent. browser.js adds a marker, Text and an eraser to the palette: while the marker
// is on, a drag draws, typing writes words where the pointer is, and a click works the page as usual. A click after
// drawing makes the drawing a step: a picture of the screen as the user saw it (from the tab, shared once: the
// screen extension), cropped to the drawing. Enter in the message line sends the steps and the words typed there,
// together, to the agent picked in the chat (else agent1), with the pictures attached to the message itself
// (the team's send, with images), in step order.
//   page message   doodle_send {to, text, first: [click], steps: [{shot, area, drawn, words: [str], then: [click]}],
//                  marks: [{kind: "line" | "words", points, text?, said, anchor?}]}
//                  (shot: a path from /screen/shot, or null when the tab wasn't shared; area: the part of the main
//                  space the picture shows, main px; drawn: anything drawn on it; words: what the user typed on it,
//                  exactly; clicks are words browser.js wrote; marks: what is still drawn at Enter, main px, and
//                  what the page can tell about each from geometry alone ("said": closed loop around "Total", ...), and
//                  anchor: the thing it is most about ({card, text, row?} ..., at: where it was), so it moves with it)
// The board is shared: the user's marks stay after Enter, and the agents draw too.
//   groups   each Enter with marks is a group (g1, g2, ...): the user's marks, then the agent's marks in reply.
//            data/doodle.json {last, lastMark, groups: {id: {board, to, by, state, dim, label, ts}},
//            marks: {id: {group, by, kind, board, points?, text?, said?, gesture?, on?, to?, words?, box?}}}
//            state: open (its agent hasn't answered yet) → answered (its turn ended) → cleared (by the user's ✓ or
//            the agent's doodle_clear; it can be brought back from the chat log: doodle_restore). Nothing clears by
//            itself. dim: an answered group, after the user sent something newer.
//   tools    doodle_mark   a gesture on a thing (ring, underline, strike, tick, cross, arrow to another thing, or
//                          none) with a few handwritten words; the page works out where, so no coordinates
//            doodle_clear  a group is dealt with: its marks go for everyone (or one of the agent's own marks, for good)
//   check    host.api.doodle.check(target): asks an open page where a thing is ({box} in main px, or {error});
//            null when no page answers. note/ uses it too, for the agent's notes.
//   events   doodle_group {group, marks}   doodle_gone {group}   doodle_mark {mark}   doodle_erased {id}   doodle_check
//   page     doodle_clear {group}  doodle_restore {group}  doodle_erase {id}  doodle_dim  doodle_checked {req, box|error}
//   GET /doodle/all   {groups, marks}
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const host = (globalThis as any).chalky;
const s = (n: number) => (n === 1 ? "" : "s");
const FILE = path.join(host.data, "doodle.json");
if (!host.shared.has("doodle"))
  host.shared.set("doodle", fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { last: 0, lastMark: 0, groups: {}, marks: {} });
const D = host.shared.get("doodle");
if (!host.shared.has("doodle-run")) host.shared.set("doodle-run", { own: {}, current: {}, started: {}, checks: new Map() });
const run = host.shared.get("doodle-run");  // own: agent -> the group it started this turn; current: agent -> the user's group this turn answers;
// started: agent -> its turn began; checks: req -> resolve
const save = () => fs.writeFileSync(FILE, JSON.stringify(D));
const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
const marksOf = (g: string) => Object.entries(D.marks).filter(([, m]: any) => m.group === g) as [string, any][];

function dim() {  // the user sent something new: answered groups step back
  const changed = Object.entries(D.groups).filter(([, g]: any) => g.state === "answered" && !g.dim);
  for (const [, g] of changed as any) g.dim = true;
  if (changed.length) { save(); for (const [id] of changed) host.broadcast("doodle_group", { group: id, ...D.groups[id] }); }
}

function check(target: any): Promise<any> {  // where is this thing on the page? The first page to answer says
  const req = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { run.checks.delete(req); resolve(null); }, 4000);
    run.checks.set(req, (answer: any) => { clearTimeout(timer); run.checks.delete(req); resolve(answer); });
    host.broadcast("doodle_check", { req, target });
  });
}

function label(m: any) { return m.said?.replace(/, box x=.*$/, "") || (m.text ? `"${m.text}"` : "a mark"); }  // without the numbers

function newGroup(by: string, to: string, board: number, labelText: string) {
  const id = `g${++D.last}`;
  D.groups[id] = { board, to, by, state: by === "user" ? "open" : "answered", dim: false, label: labelText, ts: Date.now() };
  return id;
}

// What is still on the board besides this group, for the agent (ids it can point at, or clear)
function others(except: string) {
  return Object.entries(D.groups).filter(([id, g]: any) => id !== except && g.state !== "cleared").map(([id, g]: any) =>
    `  ${id} (${g.state}${g.dim ? ", dimmed" : ""}, board ${g.board}): ` + marksOf(id).map(([mid, m]) =>
      m.by === "user" ? `${mid} ${label(m)}` : `${mid} ${m.by}'s ${m.gesture}${m.words ? ` "${m.words}"` : ""}`).join("; "));
}

function message(msg: any, group: string | null, ids: string[]) {
  const steps: any[] = msg.steps ?? [];
  const shots: string[] = steps.map((st) => st.shot).filter((p) => host.api.screen?.isShot(p));
  const words = String(msg.text ?? "").trim();
  const lines = [`[doodles on the page] ${words || "(no words: the drawing says it)"}`];
  if (group) {
    lines.push(`group: ${group} (your marks join it. If you make the change it asks for, doodle_clear("${group}") once it is made; if your answer is on the board, leave it for the user to see)`,
      "marks still on the page (main-space px; what the page can tell from the geometry; the picture shows the rest):",
      ...ids.map((id) => `  ${id}: ${D.marks[id].said}`));
    const rest = others(group);
    if (rest.length) lines.push("other groups still on the page (doodle_clear the ones that are done: their change is made, or their answer seen):", ...rest);
  }
  lines.push(`${steps.length} step${s(steps.length)}, ${shots.length} picture${s(shots.length)} attached in this order`
    + (shots.length === steps.length ? "" : " (the tab wasn't shared for the others: words only)") + ":");
  if (msg.first?.length) lines.push(`  first: ${msg.first.join("; ")}`);
  let n = 0;
  steps.forEach((st, i) => {
    const has = shots.includes(st.shot), a = st.area;
    if (has) n++;
    lines.push(`Step ${i + 1}` + (st.board ? ` on board ${st.board}` : "") + (has ? ` (picture ${n})` : " (no picture)")
      + (has && a ? `, showing x=${a.x} y=${a.y} w=${a.width} h=${a.height} of the page` : "")
      + (st.drawn ? "" : ": nothing drawn, how the screen looked after those clicks"));
    for (const w of st.words ?? []) lines.push(`  words: "${w}"`);
    if (st.then?.length) lines.push(`  then: ${st.then.join("; ")}`);
  });
  return { text: lines.join("\n"), shots };
}

function clear(group: string, by: string) {
  const g = D.groups[group];
  g.state = "cleared";
  g.clearedBy = by;
  save();
  host.broadcast("doodle_group", { group, ...g });
}

function erase(id: string) {  // a mark, for good (the eraser; an agent taking one of its marks away)
  const group = D.marks[id].group;
  delete D.marks[id];
  if (!marksOf(group).length) delete D.groups[group];
  save();
  host.broadcast("doodle_erased", { id, group });
}

host.api.doodle = { check, dim };

// A thing on the page, as the agent names it (the tools' "on" and "to")
const Target = Type.Object({
  card: Type.Optional(Type.String({ description: "card id" })),
  block: Type.Optional(Type.String({ description: "block id in that card" })),
  element: Type.Optional(Type.String({ description: "a CSS selector, or an element's id or data-name (also inside an app's frame)" })),
  text: Type.Optional(Type.String({ description: "exact text shown on the page (in the card/element if given): the mark goes on just those words" })),
  mark: Type.Optional(Type.String({ description: "a mark's id (m3): the user's mark or yours" })),
  note: Type.Optional(Type.String({ description: "a note's id (n2)" })),
  at: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() }, {
    description: "last resort, for something with no name: a box in window px, as screen_see's picture shows it" })),
}, { description: "What the mark is on: give as few fields as name it exactly, e.g. {card, text}. The page's own controls "
  + "have names too: {element: \"pen\"} (also text, eraser, show-marks, note, frames, files, dictate, tools, rail, messages, "
  + "versions, message-line, boards, new-board)." });
const named = (t: any) => Object.entries(t ?? {}).filter(([, v]) => v)
  .map(([k, v]) => k === "at" ? `at x=${v.x} y=${v.y} w=${v.width} h=${v.height}` : `${k} "${v}"`).join(", ");

export default function (pi: ExtensionAPI) {
  const me = () => pi.getSessionName()!;
  // a removed board (board/) takes its marks with it
  pi.on("session_start", () => host.api.board?.onRemove("doodle", (n: number) => {
    for (const [id, g] of Object.entries(D.groups) as any) if ((g.board ?? 1) === n) {
      for (const [mid] of marksOf(id)) delete D.marks[mid];
      delete D.groups[id];
      host.broadcast("doodle_gone", { group: id });
    }
    save();
    return [];
  }));
  pi.on("agent_start", () => {  // the group this turn answers: the newest the user sent this agent that it hasn't answered yet
    delete run.own[me()];
    run.started[me()] = Date.now();
    run.current[me()] = Object.entries(D.groups).filter(([, g]: any) => g.to === me() && g.by === "user" && g.state === "open")
      .sort(([, x]: any, [, y]: any) => y.ts - x.ts)[0]?.[0];
  });
  pi.on("agent_settled", () => {  // this agent's turn is over: the groups it had when it started are answered
    let changed = false;
    for (const [id, g] of Object.entries(D.groups) as any)
      if (g.to === me() && g.state === "open" && g.ts <= (run.started[me()] ?? 0)) { g.state = "answered"; changed = true; host.broadcast("doodle_group", { group: id, ...g }); }
    if (changed) save();
  });

  pi.registerTool({
    name: "doodle_mark", label: "Doodle mark",
    description: "Draw on the page in your own ink, by hand, as a colleague would with a pen: a gesture on a thing, and/or a few "
      + "handwritten words beside it. The page works out where; you only name the thing. Use it to show, point out or "
      + "ask about one exact thing. Explanations go in a note (note_add), not here.",
    parameters: Type.Object({
      gesture: Type.Union(["ring", "underline", "strike", "tick", "cross", "arrow", "none"].map((g) => Type.Literal(g)),
        { description: "ring: circle it (look here, a problem, an option); underline; strike: through it (this is wrong); tick: ✓ beside it (yes, this one); cross: ✕ over it (only for: remove this); arrow: from on to to; none: only words" }),
      on: Target,
      to: Type.Optional(Target),
      words: Type.Optional(Type.String({ description: "at most 40 characters, handwritten beside it" })),
      group: Type.Optional(Type.String({ description: "the group you are answering (g3, from the message); left out: the group of the message you are answering, else a new group of your own" })),
    }),
    async execute(_id, a) {
      const agent = me();
      if (a.words && a.words.length > 40) return result(`error: words are at most 40 characters (yours: ${a.words.length}). Put the longer text in a note (note_add).`);
      if (a.gesture === "arrow" && !a.to) return result("error: an arrow needs to (the thing it points at)");
      if (a.gesture === "none" && !a.words) return result("error: gesture none needs words");
      if (!named(a.on)) return result("error: on names nothing: give card, block, element, text, mark, note or at");
      const unknown = a.group && !D.groups[a.group] ? a.group : null;  // a made-up group: use the usual one instead
      if (unknown) a.group = undefined;
      const where = await check(a.on);
      if (where?.error) return result(`error: ${where.error} (on: ${named(a.on)}). Name it as it is on the page: a card id, a block id, an element's id or data-name, or its exact text.`);
      const to = a.to ? await check(a.to) : null;
      if (to?.error) return result(`error: ${to.error} (to: ${named(a.to)})`);
      let group = a.group ?? run.current[agent] ?? run.own[agent];  // else this turn's own group (not an older one of the user's)
      if (!group || D.groups[group]?.state === "cleared") {  // nothing of the user's to answer: a group of the agent's own
        group = run.own[agent] = newGroup(agent, agent, where?.board ?? host.api.board?.current() ?? 1, `${agent}'s ${a.gesture} on ${named(a.on)}`);
        host.broadcast("doodle_group", { group, ...D.groups[group] });
      }
      const id = `m${++D.lastMark}`;
      D.marks[id] = { group, by: agent, kind: "gesture", board: where?.board ?? D.groups[group].board, gesture: a.gesture, on: a.on,
                      ...(a.to && { to: a.to }), ...(a.words && { words: a.words }), ...(where?.box && { box: where.box }), ...(to?.box && { toBox: to.box }),
                      ...(where?.fixed && { fixed: true }), ...(to?.fixed && { toFixed: true }) };  // fixed: on the page's own controls (window px)
      save();
      host.broadcast("doodle_mark", { id, ...D.marks[id] });
      return result(`drew ${id} (${a.gesture}${a.words ? ` "${a.words}"` : ""} on ${named(a.on)}) in group ${group}`
        + (unknown ? ` (there is no group '${unknown}': leave group out next time)` : "") + "; the user sees it: don't repeat it in your reply"
        + (where ? "" : " (no page open to check the target: it shows when one opens)"));
    },
  });

  pi.registerTool({
    name: "doodle_clear", label: "Doodle clear",
    description: "A group of marks is dealt with: clear it (the user's marks and yours in it go, for everyone; the user can bring "
      + "them back from the chat log). Clear it when you have made the change it asks for (the change is the answer), or in a "
      + "later turn once the user has seen your marks and moved on. Not while your answer on the board is still to be seen, or its question is open.",
    parameters: Type.Object({
      group: Type.Optional(Type.String({ description: "e.g. g3: the whole group" })),
      mark: Type.Optional(Type.String({ description: "e.g. m7: just this one of your marks, for good (one of several things you marked is dealt with)" })),
    }),
    async execute(_id, a) {
      if (a.mark) {
        const m = D.marks[a.mark];
        if (!m) return result(`error: no mark '${a.mark}'`);
        if (m.by !== me()) return result(`error: ${a.mark} is ${m.by === "user" ? "the user's" : m.by + "'s"}: you can only take away your own marks (clear the group instead)`);
        erase(a.mark);
        return result(`took ${a.mark} away; the rest of ${m.group} stays`);
      }
      if (!a.group) return result("error: give group, or mark");
      const g = D.groups[a.group];
      if (!g) return result(`error: no group '${a.group}'. Groups: ${Object.keys(D.groups).join(", ") || "none"}`);
      if (g.state === "cleared") return result(`${a.group} is already cleared`);
      clear(a.group, me());
      return result(`cleared ${a.group}: its marks are gone from the page`);
    },
  });

  host.routes.set("/doodle/all", (_req: any, res: any) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ groups: D.groups, marks: D.marks })));

  host.pageHandlers.set("doodle", (msg: any) => {
    const team = host.api.team;
    if (msg.type === "doodle_checked") return run.checks.get(msg.req)?.(msg);
    if (msg.type === "doodle_dim") return dim();
    if (msg.type === "doodle_clear" && D.groups[msg.group]) {
      clear(msg.group, "user");
      const g = D.groups[msg.group];
      if (host.agents.has(g.to)) team?.fyi("page", g.to, `[doodles on the page] the user cleared group ${msg.group} (${g.label}): done with it.`);
      return;
    }
    if (msg.type === "doodle_restore" && D.groups[msg.group]) {
      const g = D.groups[msg.group];
      Object.assign(g, { state: "answered", dim: false });
      delete g.clearedBy;
      save();
      host.broadcast("doodle_group", { group: msg.group, ...g });
      if (host.agents.has(g.to)) team?.fyi("page", g.to, `[doodles on the page] the user brought group ${msg.group} (${g.label}) back onto the page.`);
      return;
    }
    if (msg.type === "doodle_erase" && D.marks[msg.id]) return erase(msg.id);  // the eraser: for good
    if (msg.type !== "doodle_send" || !team) return;
    const to = msg.to in team.status() ? msg.to : "agent1";
    dim();
    let group: string | null = null;
    const ids: string[] = [];
    if (msg.marks?.length) {
      const board = Number(msg.board) || 1;
      group = newGroup("user", to, board, msg.marks.map(label).slice(0, 2).join(", ").slice(0, 80));
      for (const m of msg.marks) {
        const id = `m${++D.lastMark}`;
        D.marks[id] = { group, by: "user", kind: m.kind, board, points: m.points, ...(m.text && { text: m.text }), said: m.said, ...(m.anchor && { anchor: m.anchor }) };
        ids.push(id);
      }
      save();
      host.broadcast("doodle_group", { group, ...D.groups[group], marks: Object.fromEntries(ids.map((id) => [id, D.marks[id]])) });
    }
    const { text, shots } = message(msg, group, ids);
    team.send("user", to, text, false, shots);
  });
}
