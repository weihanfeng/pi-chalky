// The prompt after SYSTEM.md (pi's documented way to replace its default prompt, plain text): one section per
// extension, its guide.md, then <paths>. A guide.md is found by looking in each extension folder, as the page finds
// browser.js, so an extension has nothing to register. Read again on every input (an edited guide shows at once).
// In a guide: {agent} {built} {data} {workspace} {page} become the full paths and address, {name} and {role} this
// agent's, and README.md the full path of that extension's README.md. pi adds the skills list and <cwd> itself.
// READMEs and skills keep the placeholders as written (agents edit them; <paths> says what each one is).
import fs from "node:fs";
import path from "node:path";
import { getDocsPath, getExamplesPath, getReadmePath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const EXTENSIONS = path.dirname(import.meta.dirname);

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const name = pi.getSessionName() ?? "", page = `http://127.0.0.1:${host.port}`;
    const values: Record<string, string> = { agent: host.agent, built: host.built, data: host.data, workspace: host.workspace,
      page, name, role: host.agents.get(name)?.role ?? "" };
    const sections = event.systemPromptOptions.sections;
    for (const ext of fs.readdirSync(EXTENSIONS).sort()) {
      const guide = path.join(EXTENSIONS, ext, "guide.md");
      if (!fs.existsSync(guide)) continue;
      sections[ext] = fs.readFileSync(guide, "utf8").replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m)
        .replaceAll("README.md", path.join(EXTENSIONS, ext, "README.md"));
    }
    sections.paths = [
      `{agent} = ${host.agent}: you: your prompt, settings, extensions/ and skills/`,
      `{built} = ${host.built}: what you make for the user: card.json (the cards), board.json (the boards), apps/<name>/ (the apps)`,
      `  {agent} and {built} are versioned together: each turn that changes them is saved, and the user can roll both back.`,
      `{data} = ${host.data}: what is kept while running (conversations, what users typed into cards and apps, notes; not versioned)`,
      `{workspace} = ${host.workspace}: your working folder (<cwd>), for project work; drops/ in it holds the user's files`,
      `{page} = ${page}: the user's page; a file in {built} is at {page}/built/<its path in {built}>`,
      `The host: ${host.root}/server.ts`,
      `pi's docs: ${getDocsPath()}/extensions.md for extensions, examples in ${getExamplesPath()}/extensions/; the rest in `
        + `${getReadmePath()} and ${getDocsPath()}/. Read pi's .md files completely and follow their links.`,
    ].join("\n");
  });
}
