// Agent commands: pi's built-in "/" commands live in its terminal UI only, so an SDK session doesn't have them. Each
// one here is a pi command (pi.registerCommand) that calls what the built-in calls (pi's docs/extensions.md).
// The page lists every pi command an agent has and sends one to the agent picked in "to" (pi runs it at once, even
// mid-run: session.prompt checks for commands first).
//   GET /commands                             -> [{name, description}] (agent1's, from app/extensions)
//   page message  command {agent, text: "/name args"}
//   page event    commands {agent, text}        -> a plain note (e.g. /compact with nothing new)
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;

export default function (pi: ExtensionAPI) {
  const guide = fs.readFileSync(path.join(import.meta.dirname, "guide.md"), "utf8");
  pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.commands = guide; });

  // pi's /compact: summarize the conversation now (the page shows "history compacted" when it's done). Whatever its
  // size: keepRecentTokens is 0 for this one (in memory, not saved), so all but the newest message is summarized;
  // the automatic compaction keeps app/settings.json's.
  pi.registerCommand("compact", {
    description: "Summarize the agent's conversation now (words after it: what the summary should focus on)",
    handler: async (args, ctx) => {
      const agent = pi.getSessionName()!;
      // nothing said since the last compaction (its note is the newest entry): skip, it would only re-summarize the summary
      const last = ctx.sessionManager.getLeafEntry();
      if (last?.type === "compaction" || (last?.type === "custom_message" && last.customType === "compacted"))
        return host.broadcast("commands", { agent, text: "nothing new since the last compaction" });
      const settings = host.agents.get(agent).session.settingsManager;
      const keep = settings.getSettings().compaction?.keepRecentTokens;
      settings.applyOverrides({ compaction: { keepRecentTokens: 0 } });
      const restore = () => settings.applyOverrides({ compaction: { keepRecentTokens: keep } });
      ctx.compact({ customInstructions: args.trim() || undefined, onComplete: restore,
        onError: (e) => { restore(); host.broadcast("error", { agent, text: `compact: ${e.message}` }); } });
    },
  });

  // pi's /thinking: how hard this agent thinks (sent as reasoning_effort; "off": nothing is sent, the model's own
  // default). pi saves it in the agent's session file, so it stays after a restart.
  pi.registerCommand("thinking", {
    description: "Set how hard the agent thinks: off, minimal, low, medium, high (none: show it)",
    handler: async (args, ctx) => {
      const agent = pi.getSessionName()!;
      const session = host.agents.get(agent).session;
      const levels = session.getAvailableThinkingLevels().join(", ");
      const level = args.trim();
      if (level && !session.getAvailableThinkingLevels().includes(level))
        return host.broadcast("error", { agent, text: `thinking: "${level}" isn't one of ${levels}` });
      if (level) pi.setThinkingLevel(level);
      host.broadcast("commands", { agent, text: `thinking ${pi.getThinkingLevel()}${level ? "" : ` (${levels})`}` });
    },
  });

  // pi's /new: an empty conversation for this agent (the swarm's reset: a new session file, role and thinking kept;
  // the old file stays). After this command returns: the reset replaces the session that is running it.
  pi.registerCommand("new", {
    description: "Start a new, empty conversation for the agent (its role stays; the old one is kept on disk)",
    handler: async () => {
      const agent = pi.getSessionName()!;
      const thinking = pi.getThinkingLevel();
      setTimeout(async () => {
        const error = await host.api.swarm.reset([agent]);
        if (error) return host.broadcast("error", { agent, text: `new: ${error}` });
        host.agents.get(agent).session.setThinkingLevel(thinking);
        host.broadcast("commands", { agent, text: "new conversation" });
      });
    },
  });

  // after any compaction (/compact or pi's automatic one): a note right after the summary, so the agent knows it just
  // happened and where the full conversation still is (pi only appends to the session file; nothing is deleted)
  pi.on("session_compact", (event, ctx) => {
    const time = new Date().toTimeString().slice(0, 8);
    pi.sendMessage({ customType: "compacted", display: false, content: `[note from system · ${time}]\nYour ` +
      `conversation was just compacted (${event.reason}): what came before is the summary above. The full ` +
      `conversation is still in ${ctx.sessionManager.getSessionFile()} when the summary isn't enough. Its lines are ` +
      `long JSON entries, so print only around a match: grep -oE '.{0,300}words.{0,300}' <file>` });
  });

  host.routes.set("/commands", (_req: any, res: any) => {
    // only ours (app/extensions): pi's built-in extensions' commands are terminal screens (e.g. its MCP's /mcp)
    const runner = host.agents.get("agent1")?.session.extensionRunner;
    const list = (runner?.getRegisteredCommands() ?? []).filter((c: any) => c.sourceInfo?.path?.startsWith(host.app))
      .map((c: any) => ({ name: c.invocationName, description: c.description ?? "" }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
  });

  host.pageHandlers.set("commands", async (msg: any) => {
    if (msg.type !== "command") return;
    const name = host.agents.has(msg.agent) ? msg.agent : "agent1";
    // a running turn is stopped first, on purpose (compact would abort it anyway; this way it isn't shown as an error)
    if (host.agents.get(name).session.isStreaming) await host.abort(name);
    try { await host.agents.get(name).session.prompt(msg.text); }
    catch (e: any) { host.broadcast("error", { agent: name, text: `${msg.text}: ${e.message}` }); }
  });
}
