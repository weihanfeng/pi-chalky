// Self-edits take effect: the Python agent's restart plugin, the pi way. The tool only asks; when this agent's turn
// has ended, the host calls pi's session.reload() (extensions, skills and prompt load again; the conversation stays).
// Not pi's reload-runtime.ts example: its pi.sendUserMessage("/reload-runtime") reaches the model as text in 1.4.0
// (expandPromptTemplates defaults to false), and the model kept calling the tool again.
// No process restart, so no start.sh (a rollback: the versions plugin, which reloads every agent).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "reload", label: "Reload", description: "Load your edited extensions again, when your turn ends.",
    parameters: Type.Object({ reason: Type.String() }),
    async execute(_id, a) {
      const host = (globalThis as any).chalky, name = pi.getSessionName();
      host.reloadAfterTurn.add(name);
      host.shared.set(`reload-reason ${name}`, a.reason);  // the versions plugin's commit message for this turn
      return { content: [{ type: "text", text: "Reload scheduled for when your turn ends. End your turn now; don't call reload again." }],
               details: undefined };
    },
  });
}
