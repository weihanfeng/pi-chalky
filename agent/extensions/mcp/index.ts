// MCP picker: "/mcp" on the page ticks which servers in agent/mcp.json, and which of their tools, the agents may use.
// pi's built-in MCP does the rest (server.ts loads it; pi's docs/mcp.md). A tick writes the fields pi's own /mcp
// screen writes, in that file: "enabled": false for a server, toolExposure "<tool>": "hidden" (or back to the
// server's exposure) for a tool. Then every agent reloads, one change at a time (a busy agent after its turn).
// Tools: agent1's, from pi (getAllTools), once its connection to the server is up.
//   page message  mcp_list                                 -> event "mcp" {file, servers: {name: {enabled, description,
//                 mcp_set {server, on} | {server, tool, on}       tools: [{name, description, on}]}}, error}
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const FILE = path.join(host.agent, "mcp.json");

// The file is the user's and no release ships it, so a new home has none: that's no servers yet, not an error.
function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch (e: any) { if (e.code === "ENOENT") return {}; throw e; }
}

function state() {
  const servers = read().mcpServers ?? {};
  const tools = host.agents.get("agent1")?.session.getAllTools() ?? [];
  const out: Record<string, any> = {};
  for (const [name, c] of Object.entries<any>(servers)) {
    const enabled = c.enabled !== false;
    out[name] = { enabled, description: c.description ?? c.url ?? c.command ?? "",
      tools: tools.filter((t: any) => t.namespace?.aliases?.[0] === name).map((t: any) => {
        const tool = t.name.slice(t.namespace.name.length + 2);  // mcp__<server>__<tool>
        return { name: tool, description: t.description, on: enabled && (c.toolExposure?.[tool] ?? t.exposure) !== "hidden" };
      }) };
  }
  return { file: FILE, servers: out, error: "" };
}

function set(msg: any) {
  const json = read(), c = json.mcpServers?.[msg.server];
  if (!c) return;
  if (msg.tool === undefined) { if (msg.on) delete c.enabled; else c.enabled = false; }
  else {
    const own = c.exposure ?? "codemode";  // pi's default
    (c.toolExposure ??= {})[msg.tool] = !msg.on ? "hidden" : own === "hidden" ? "direct" : own;
  }
  fs.writeFileSync(FILE, JSON.stringify(json, null, 2) + "\n");
}

async function reloadAll() {
  for (const a of host.agents.values()) {
    if (a.session.isStreaming) { if (!host.reloadAfterTurn.has(a.name)) host.reloadAfterTurn.set(a.name, true); }
    else await host.reloadAgent(a.name, true);  // quiet: ticking isn't news for the conversation
  }
}

export default function (pi: ExtensionAPI) {

  host.pageHandlers.set("mcp", async (msg: any) => {
    if (msg.type !== "mcp_list" && msg.type !== "mcp_set") return;
    try {
      if (msg.type === "mcp_set") set(msg);
      host.broadcast("mcp", state());  // before the reloads: agent1's tools are still listed, the file has the ticks
    } catch (e: any) {
      return host.broadcast("mcp", { file: FILE, servers: {}, error: `${FILE}: ${e.message}` });
    }
    // reloads one after another, also across this extension's own reloads (host.shared outlives them)
    if (msg.type === "mcp_set") host.shared.set("mcp-reloads", (host.shared.get("mcp-reloads") ?? Promise.resolve())
      .then(reloadAll).catch((e: any) => console.error("mcp: reload failed:", e)));
  });
}
