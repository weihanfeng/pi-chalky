// A limit on steps (model calls) per input, as the Python loop's MAX_STEPS: pi's loop has none, and a model that
// keeps calling tools would run on (it did once: 55 rounds). At the limit the run is stopped and the agent says so.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_STEPS = Number(process.env.MAX_STEPS || 30);

export default function (pi: ExtensionAPI) {
  let steps = 0;
  pi.on("before_agent_start", () => { steps = 0; });  // once per input (retries and steering don't reset it)
  pi.on("turn_end", (_event, ctx) => {
    if (++steps !== MAX_STEPS) return;  // once: the stopped reply is one more turn_end
    ctx.abort();
    (globalThis as any).chalky.broadcast("error", { agent: pi.getSessionName(), text: `stopped after ${MAX_STEPS} steps` });
  });
}
