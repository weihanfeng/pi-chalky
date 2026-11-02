// The page side of the command extension: the agents' pi commands (GET /command) join the "/" list in the chat
// input. One runs on the agent picked in "to" (agent1 if none), with the words after it.
export default function (page) {
  const target = () => document.getElementById("to")?.value || "main";
  page.on("command", (ev) => page.note(`${ev.agent}: ${ev.text}`));
  fetch("/command").then((r) => r.ok ? r.json() : []).then((list) => {
    for (const c of list) page.command(c.name, (rest) => {
      const agent = target() === "main" ? "agent1" : target();
      page.note(`/${c.name} → ${agent}`);
      page.send({ type: "command", agent, text: `/${c.name} ${rest}`.trim() });
    }, c.description);
  });
}
