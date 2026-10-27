// Talks to the agent as the page does: node tests/say.mjs '<json to send>' ; prints what comes back (after the
// replay) until every agent is idle again. e.g. node tests/say.mjs '{"to":"main","text":"hi"}'
import WebSocket from "ws";

const send = JSON.parse(process.argv[2]);
const ws = new WebSocket("ws://127.0.0.1:3000/ws");
const start = Date.now() / 1000;
let ran = false, steps = 0;
const short = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
ws.on("open", () => setTimeout(() => ws.send(JSON.stringify(send)), 300));  // after the replay
ws.on("message", (raw) => {
  const ev = JSON.parse(raw);
  if (ev.type === "message" && ev.ts < start) return;  // replayed history
  if (ev.type === "message") {
    const calls = (ev.tool_calls || []).map((c) => `${c.function.name}(${short(c.function.arguments, 120)})`).join(", ");
    console.log(`${ev.agent} ${ev.role}:`, short(ev.content), calls && `-> ${calls}`, ev.reasoning ? "[thinking]" : "");
  } else if (ev.type === "status") {
    const s = Object.entries(ev.agents).map(([a, v]) => `${a}=${v.state}`).join(" ");
    console.log("status", s);
    if (ran && Object.values(ev.agents).every((v) => v.state === "idle")) ws.close();
  } else if (ev.type === "ui") console.log("ui", ev.op, ev.surface, ev.place ? JSON.stringify(ev.place) : "");
  else console.log(ev.type, ev.agent ?? "", short(ev.text ?? ""));
  if (ev.type === "message" && ev.role === "assistant" && ++steps > 20) { console.log("TOO MANY STEPS: stop"); ws.send(JSON.stringify({ type: "stop" })); }
  if (ev.type === "run_start") ran = true;
  if (!("to" in send) && ev.type === "ui") setTimeout(() => ws.close(), 200);  // a page message: one ui event
});
ws.on("close", () => process.exit(0));
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 240000);
