// Browser half of the files plugin: the file panel on the right edge (slot "side"), one name per row,
// collapsed and opened by its folder button (remembered in this browser). Hidden while there are no files.
//   Files dragged from the computer onto the page: uploaded (POST /files/upload), then a "files-dropped"
//   DOM event {x, y, files: [{name, path, size}]} at the drop spot (the point plugin opens its note box
//   there). Dropped onto the panel itself: only stored.
//   A row dragged out of the panel onto the page: the same event, with that file.
//   A click on a row, or files dropped from the computer (the first of them): a "file-open" DOM event
//   {file, row} (the viewer plugin opens a preview window attached to the row; rows carry data-path).
// The list comes from GET /files, then from "files" events (after an upload, and after each agent turn).
export default async function (page) {
  const side = page.slot("side");
  const style = document.createElement("style");
  style.textContent = `
    #side .files-toggle { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--muted);
                          align-self: flex-end; margin: 16px 9px 0 0; transition: background 0.15s, color 0.15s; }
    #side .files-toggle:hover { background: var(--hover); color: var(--text); }
    #side[data-open] .files-toggle { background: var(--glass-strong); color: var(--text);
                                     box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), inset 0 0 0 1px var(--edge); }
    #side .files { display: none; width: 220px; max-height: calc(100vh - 140px); overflow-y: auto; margin: 8px 9px 0 0;
                   padding: 8px; box-sizing: border-box; border-radius: var(--radius); font-size: 13px;
                   background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
                   border: 1px solid var(--edge); box-shadow: var(--shadow); }
    #side[data-open] .files { display: block; }
    #side[data-over] .files { outline: 2px solid var(--accent); outline-offset: -2px; }
    #side .files-row { padding: 5px 8px; border-radius: 8px; color: var(--soft); cursor: grab;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #side .files-row:hover, #side .files-row.viewing { background: var(--hover); color: var(--text); }`;
  document.head.append(style);

  const toggle = document.createElement("button");
  toggle.className = "files-toggle";
  toggle.title = "Files: drop files anywhere on the page; drag a name onto the page to use it there";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const list = document.createElement("div");
  list.className = "files";
  side.append(toggle, list);

  const setOpen = (open) => {
    side.toggleAttribute("data-open", open);
    try { localStorage.setItem("files-open", open ? "1" : ""); } catch {}
  };
  let open = true;
  try { open = localStorage.getItem("files-open") !== ""; } catch {}
  setOpen(open);
  toggle.onclick = () => setOpen(!side.hasAttribute("data-open"));

  const ROW = "application/x-chalky-file";  // a row being dragged: its file as JSON
  function render(files) {
    list.replaceChildren();
    side.hidden = !files.length;  // no files yet: no panel (a drop from the computer still works anywhere)
    for (const f of files) {
      const row = Object.assign(document.createElement("div"), { className: "files-row", textContent: f.name, draggable: true });
      row.title = `${f.path} · ${Math.ceil(f.size / 1024)} KB · click to preview`;
      row.dataset.path = f.path;
      row.onclick = () => opened(f);  // a drag never ends in a click, so dragging a row still works
      row.ondragstart = (e) => { e.dataTransfer.setData(ROW, JSON.stringify(f)); e.dataTransfer.effectAllowed = "copy"; };
      list.append(row);
    }
  }
  page.on("files", ({ files }) => render(files));
  try { render(await (await fetch("/files")).json()); } catch { render([]); }

  const kind = (e) => {
    const types = [...(e.dataTransfer?.types || [])];
    return types.includes(ROW) ? "row" : types.includes("Files") ? "files" : null;
  };
  const onPanel = (e) => side.contains(e.target);
  const opened = (file) => document.dispatchEvent(new CustomEvent("file-open",
    { detail: { file, row: list.querySelector(`[data-path="${CSS.escape(file.path)}"]`) } }));
  const dropped = (x, y, files) => document.dispatchEvent(new CustomEvent("files-dropped", { detail: { x, y, files } }));

  document.addEventListener("dragover", (e) => {
    if (!kind(e)) return;
    e.preventDefault();
    side.toggleAttribute("data-over", kind(e) === "files" && onPanel(e));
  });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) side.removeAttribute("data-over"); });
  document.addEventListener("drop", async (e) => {
    const k = kind(e);
    if (!k) return;
    e.preventDefault();
    side.removeAttribute("data-over");
    const { clientX: x, clientY: y } = e;
    if (k === "row") return onPanel(e) || dropped(x, y, [JSON.parse(e.dataTransfer.getData(ROW))]);
    const stored = [];
    for (const f of [...e.dataTransfer.files].slice(0, 10)) {
      try {
        const out = await (await fetch(`/files/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f })).json();
        if (out.path) stored.push({ name: out.path.split("/").pop(), path: out.path, size: out.size });
        else page.note(`Could not upload ${f.name}: ${out.error}`);
      } catch (err) { page.note(`Could not upload ${f.name}: ${err}`); }
    }
    if (stored.length) opened(stored[0]);  // the list has its row by now (the "files" event comes before the reply)
    if (stored.length && !onPanel(e)) dropped(x, y, stored);
  });
}
