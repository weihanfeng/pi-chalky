// Where things are: the paths the prompt needs that depend on this machine, as the <paths> section. The prompt's
// words are app/SYSTEM.md (pi's documented way to replace its default prompt), which is plain text and can't hold
// these. pi adds the skills list and the working folder (<cwd>) itself.
import { getDocsPath, getExamplesPath, getReadmePath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const host = (globalThis as any).chalky;
    event.systemPromptOptions.sections.paths = [
      `Your code folder: ${host.app} (versioned: each turn that changes it is saved, and the user can roll back)`,
      `The host: ${host.root}/server.ts`,
      `pi's docs: ${getDocsPath()}/extensions.md for extensions, examples in ${getExamplesPath()}/extensions/; the rest in `
        + `${getReadmePath()} and ${getDocsPath()}/. Read pi's .md files completely and follow their links.`,
    ].join("\n");
  });
}
