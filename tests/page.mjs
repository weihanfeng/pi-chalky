// Sends page messages (as the page's browser plugins do) and prints what comes back for a while.
// node tests/page.mjs <seconds> '<json>' ['<json>' ...]   (each sent 1 s after the one before)
import WebSocket from "ws";

const [secs, ...msgs] = process.argv.slice(2);
const ws = new WebSocket("ws://127.0.0.1:3000/ws");
const start = Date.now() / 1000;
ws.on("open", () => msgs.forEach((m, i) => setTimeout(() => ws.send(m), 500 + i * 1000)));
ws.on("message", (raw) => {
  const ev = JSON.parse(raw);
  if (ev.type === "message" && ev.ts < start) return;  // replayed history
  if (ev.type === "status") console.log("status", Object.entries(ev.agents).map(([a, v]) => `${a}=${v.state}${v.app ? `(app ${v.app})` : ""}`).join(" "));
  else if (ev.type === "message") console.log(`${ev.agent} ${ev.role}:`, String(ev.content).replace(/\s+/g, " ").slice(0, 140));
  else console.log(ev.type, ev.agent ?? "", ev.text ?? "");
});
setTimeout(() => process.exit(0), Number(secs) * 1000);
