// The page side of the mcp extension: "/mcp" in the chat input opens a picker of the servers in agent/mcp.json. A
// server's box turns it on or off; open it to tick single tools (greyed while the server is off). Each change is
// saved at once (mcp_set). A server's tools show once the agents have connected to it.
const STYLE = `
  .mcp { width: min(560px, calc(100vw - 32px)); max-height: 75vh; padding: 16px 18px; box-sizing: border-box;
         border-radius: var(--radius, 16px); border: 1px solid var(--edge, #eee); color: var(--text, #1d1d1f);
         background: var(--glass-strong, #fff); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
         box-shadow: var(--shadow, 0 8px 30px rgba(0,0,0,.1)); font-size: 13px; }
  .mcp::backdrop { background: rgba(0, 0, 0, .08); }
  .mcp header { display: flex; justify-content: space-between; margin-bottom: 10px; font-weight: 600; }
  .mcp header button { font: inherit; color: var(--muted, #888); background: none; border: 0; cursor: pointer; }
  .mcp p { color: var(--muted, #888); margin: 0 0 10px; } .mcp p.error { color: #c62828; }
  .mcp details { border-top: 1px solid rgba(128, 128, 128, .2); padding: 8px 0; }
  .mcp summary { display: flex; gap: 8px; align-items: center; cursor: pointer; list-style: none; }
  .mcp summary span { margin-left: auto; color: var(--muted, #888); }
  .mcp label { display: flex; gap: 8px; align-items: baseline; padding: 4px 0 4px 24px; cursor: pointer; }
  .mcp label span { color: var(--muted, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export default function (page) {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const box = document.createElement("dialog");
  box.className = "mcp";
  document.body.append(box);
  box.onclick = (e) => { if (e.target === box) box.close(); };  // a click on the backdrop closes it
  let state = null;  // the "mcp" event: {file, servers, error}
  const open = new Set();  // servers whose tools are shown, kept across redraws
  const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const tick = (checked, onchange, more = {}) => el("input", { type: "checkbox", checked, onchange, ...more });

  function render() {
    const close = el("button", { title: "Close", onclick: () => box.close() }, "✕");
    box.replaceChildren(el("header", {}, "MCP tools", close));
    if (!state) return box.append("Asking…");
    box.append(el("p", {}, `Tick what the agents may use. The servers are in ${state.file}.`));
    if (state.error) box.append(el("p", { className: "error" }, state.error));
    const servers = Object.entries(state.servers);
    if (!servers.length && !state.error) box.append(el("p", {}, "No servers yet: add them to that file."));
    for (const [server, s] of servers) {
      const on = s.tools.filter((t) => t.on).length;
      const all = tick(s.enabled, () => page.send({ type: "mcp_set", server, on: all.checked }),
        { onclick: (e) => e.stopPropagation() });  // ticking the server doesn't open or close it
      const count = s.tools.length ? `${on}/${s.tools.length}` : s.enabled ? "no tools yet" : "off";
      const d = el("details", { open: open.has(server) },
        el("summary", {}, all, el("b", { title: s.description }, server), el("span", {}, count)));
      d.ontoggle = () => d.open ? open.add(server) : open.delete(server);
      for (const t of s.tools) {
        const one = tick(t.on, () => page.send({ type: "mcp_set", server, tool: t.name, on: one.checked }), { disabled: !s.enabled });
        d.append(el("label", { title: t.description }, one, t.name, el("span", {}, t.description)));
      }
      box.append(d);
    }
  }

  page.command("mcp", () => {
    state = null;  // ask again each time: mcp.json or the connections may have changed
    render();
    box.showModal();
    page.send({ type: "mcp_list" });
  }, "Choose the MCP tools the agents may use");
  page.on("mcp", (ev) => { state = ev; if (box.open) render(); });
}
