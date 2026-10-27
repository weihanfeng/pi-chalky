// Doodle: draw on the page, click through it, and send the whole sequence to an agent (port of the Python doodle
// plugin; browser.js is its doodle.js). browser.js adds a marker, Text and an eraser to the palette: while the marker
// is on, a drag draws, typing writes words where the pointer is, and a click works the page as usual. A click after
// drawing makes the drawing a step: a picture of the screen as the user saw it (from the tab, shared once: the
// screen extension), cropped to the drawing. Enter in the message line sends the steps and the words typed there,
// together, to the agent picked in the chat (else agent1), with the pictures attached to the message itself
// (swarm send's images), in step order.
//   page message   doodle_send {to, text, first: [click], steps: [{shot, area, drawn, words: [str], then: [click]}]}
//                  (shot: a path from /screen/shot, or null when the tab wasn't shared; area: the part of the main
//                  space the picture shows, main px; drawn: anything drawn on it; words: what the user typed on it,
//                  exactly; clicks are words browser.js wrote)
// The drawing itself goes only as the picture: lines aren't put into words (a guess at what a stroke means can be
// wrong, and the picture shows it).
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const s = (n: number) => (n === 1 ? "" : "s");

function message(msg: any) {
  const steps: any[] = msg.steps ?? [];
  const shots: string[] = steps.map((st) => st.shot).filter((p) => host.api.screen?.isShot(p));
  const words = String(msg.text ?? "").trim();
  const lines = [`[doodles on the UI] ${words || "(no words: the drawing says it)"}`,
    `${steps.length} step${s(steps.length)}, ${shots.length} picture${s(shots.length)} attached in this order`
    + (shots.length === steps.length ? "" : " (the tab wasn't shared for the others: words only)") + ":"];
  if (msg.first?.length) lines.push(`  first: ${msg.first.join("; ")}`);
  let n = 0;
  steps.forEach((st, i) => {
    const has = shots.includes(st.shot), a = st.area;
    if (has) n++;
    lines.push(`Step ${i + 1}` + (has ? ` (picture ${n})` : " (no picture)")
      + (has && a ? `, showing x=${a.x} y=${a.y} w=${a.width} h=${a.height} of the page` : "")
      + (st.drawn ? "" : ": nothing drawn, how the screen looked after those clicks"));
    for (const w of st.words ?? []) lines.push(`  words: "${w}"`);
    if (st.then?.length) lines.push(`  then: ${st.then.join("; ")}`);
  });
  return { text: lines.join("\n"), shots };
}

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "guide.md"), "utf8");
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.doodle = guide; });

  host.pageHandlers.set("doodle", (msg: any) => {
    const swarm = host.api.swarm;
    if (msg.type !== "doodle_send" || !swarm) return;
    const to = msg.to in swarm.status() ? msg.to : "agent1";
    const { text, shots } = message(msg);
    swarm.send("user", to, text, false, shots);
  });
}
