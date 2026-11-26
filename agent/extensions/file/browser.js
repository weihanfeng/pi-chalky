// The page side of the file extension: the file panel on the right edge (slot "side"), one name per row,
// collapsed and opened by its folder button (remembered in this browser). Hidden while there are no files.
//   Files dragged from the computer onto the page: uploaded (POST /file/upload), then a "file-dropped"
//   DOM event {x, y, files: [{name, path, size}]} at the drop spot (the note extension opens its note box
//   there). Dropped onto the panel itself: only stored.
//   Pasted (Ctrl+V / ⌘V) with files on the clipboard: the same as a drop where the pointer last was (copied
//   images, all named image.png, become pasted-<date>-<time>.png). Text pastes as usual.
//   A row dragged out of the panel onto the page: the same event, with that file.
//   A click on a row, or files dropped from the computer (the first of them): a "file-open" DOM event
//   {file, row} (the viewer extension opens a preview window attached to the row; rows carry data-path).
//   Each row's checkbox (on hover, or on all rows once one is ticked) selects it; the bar then deletes the ticked
//   files for good, after a confirm (POST /file/delete). The bar sits below the rows (sticky), so ticking one never
//   moves the rows.
// The list comes from GET /file, then from "file" events (after an upload, and after each agent turn).
export default async function (page) {
  const side = page.slot("side");
  const style = document.createElement("style");
  style.textContent = `
    #side .file-toggle { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--muted);
                          align-self: flex-end; margin: 16px 9px 0 0; transition: background 0.15s, color 0.15s; }
    #side .file-toggle:hover { background: var(--hover); color: var(--text); }
    #side[data-open] .file-toggle { background: var(--glass-strong); color: var(--text);
                                     box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), inset 0 0 0 1px var(--edge); }
    #side .file-list { display: none; width: 220px; max-height: calc(100vh - 140px); overflow-y: auto; margin: 8px 9px 0 0;
                   padding: 8px; box-sizing: border-box; border-radius: var(--radius); font-size: 13px;
                   background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
                   border: 1px solid var(--edge); box-shadow: var(--shadow); }
    #side[data-open] .file-list { display: block; }
    #side[data-over] .file-list { outline: 2px solid var(--accent); outline-offset: -2px; }
    #side .file-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 8px; color: var(--soft); cursor: grab; }
    #side .file-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #side .file-row input { appearance: none; -webkit-appearance: none; margin: 0; flex: none; visibility: hidden;
                             width: 16px; height: 16px; border-radius: 50%; cursor: pointer; background: var(--glass-strong);
                             box-shadow: inset 0 0 0 1px rgba(60, 60, 67, .3); transition: background-color .15s, box-shadow .15s; }
    #side .file-row input:hover { box-shadow: inset 0 0 0 1px var(--accent); }
    #side .file-row input:checked { box-shadow: none; background: var(--accent) center / 10px no-repeat
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    #side .file-row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    #side .file-row:hover input, #side .file-list[data-selecting] .file-row input { visibility: visible; }
    #side .file-bar { display: flex; gap: 6px; position: sticky; bottom: -8px; margin: 4px -8px -8px; padding: 8px;
                       background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
                       border-top: 1px solid var(--line); }
    #side .file-bar[hidden] { display: none; }
    #side .file-bar button { font: inherit; color: var(--text); background: var(--glass-strong); border: 1px solid var(--line);
                              border-radius: 8px; padding: 3px 10px; cursor: pointer; }
    #side .file-bar .delete { color: #fff; background: var(--danger); border-color: transparent; }
    #side .file-row:hover, #side .file-row.viewing { background: var(--hover); color: var(--text); }
    .file-uploading { position: fixed; z-index: 200000; max-width: 240px; padding: 5px 10px; border-radius: 10px; font-size: 12px;
                      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
                      background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
                      border: 1px solid var(--edge); box-shadow: var(--shadow); }`;
  document.head.append(style);

  const toggle = document.createElement("button");
  toggle.className = "file-toggle";
  toggle.dataset.name = "files";
  toggle.title = "Files: drop files anywhere on the page; drag a name onto the page to use it there";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const list = document.createElement("div");
  list.className = "file-list";
  side.append(toggle, list);

  const setOpen = (open) => {
    side.toggleAttribute("data-open", open);
    try { localStorage.setItem("file-panel-open", open ? "1" : ""); } catch {}
  };
  let open = true;
  try { open = localStorage.getItem("file-panel-open") !== ""; } catch {}
  setOpen(open);
  toggle.onclick = () => setOpen(!side.hasAttribute("data-open"));

  const selected = new Set();  // names ticked for deleting
  const bar = Object.assign(document.createElement("div"), { className: "file-bar", hidden: true });  // under the rows
  const del = Object.assign(document.createElement("button"), { className: "delete" });
  const cancel = Object.assign(document.createElement("button"), { textContent: "Cancel" });
  bar.append(del, cancel);
  const showBar = () => {
    bar.hidden = !selected.size;
    list.toggleAttribute("data-selecting", selected.size > 0);
    del.textContent = `Delete ${selected.size} file${selected.size === 1 ? "" : "s"}`;
  };
  cancel.onclick = () => { selected.clear(); list.querySelectorAll(".file-row input").forEach((t) => (t.checked = false)); showBar(); };
  del.onclick = async () => {
    const names = [...selected];
    if (!confirm(`Delete ${names.length === 1 ? names[0] : `${names.length} files`} for good?`)) return;
    try {
      const out = await (await fetch("/file/delete", { method: "POST", body: JSON.stringify({ names }) })).json();
      if (out.errors.length) page.note(`Could not delete: ${out.errors.join("; ")}`);
    } catch (err) { page.note(`Could not delete: ${err}`); }
    selected.clear();
    showBar();  // the rows go with the "file" event
  };

  const ROW = "application/x-chalky-file";  // a row being dragged: its file as JSON
  function render(files) {
    list.replaceChildren();
    side.hidden = !files.length;  // no files yet: no panel (a drop from the computer still works anywhere)
    for (const name of selected) if (!files.some((f) => f.name === name)) selected.delete(name);
    showBar();
    for (const f of files) {
      const row = Object.assign(document.createElement("div"), { className: "file-row", draggable: true });
      const tick = Object.assign(document.createElement("input"), { type: "checkbox", checked: selected.has(f.name), title: "Select to delete" });
      tick.onclick = (e) => { e.stopPropagation(); tick.checked ? selected.add(f.name) : selected.delete(f.name); showBar(); };
      row.append(tick, Object.assign(document.createElement("span"), { textContent: f.name }));
      row.title = `${f.path} · ${Math.ceil(f.size / 1024)} KB · click to preview`;
      row.dataset.path = f.path;
      row.onclick = () => opened(f);  // a drag never ends in a click, so dragging a row still works
      row.ondragstart = (e) => { e.dataTransfer.setData(ROW, JSON.stringify(f)); e.dataTransfer.effectAllowed = "copy"; };
      list.append(row);
    }
    list.append(bar);
  }
  page.on("file", ({ files }) => render(files));
  try { render(await (await fetch("/file")).json()); } catch { render([]); }

  const kind = (e) => {
    const types = [...(e.dataTransfer?.types || [])];
    return types.includes(ROW) ? "row" : types.includes("Files") ? "files" : null;
  };
  const onPanel = (e) => side.contains(e.target);
  const opened = (file) => document.dispatchEvent(new CustomEvent("file-open",
    { detail: { file, row: list.querySelector(`[data-path="${CSS.escape(file.path)}"]`) } }));
  const dropped = (x, y, files) => document.dispatchEvent(new CustomEvent("file-dropped", { detail: { x, y, files } }));

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
    store([...e.dataTransfer.files], x, y, onPanel(e));
  });

  // Upload files (at most MAX), then preview the first and fire "file-dropped" at (x, y), unless they landed on the panel
  const MAX = 10;
  async function store(all, x, y, panel, names = all.map((f) => f.name)) {
    if (all.length > MAX) page.notice([`You added ${all.length} files: only the first ${MAX} were kept.`]);
    const stored = [], files = all.slice(0, MAX), size = files.reduce((n, f) => n + f.size, 0);
    const tag = Object.assign(document.createElement("div"), { className: "file-uploading",
      textContent: `Uploading ${files.length > 1 ? `${files.length} files` : names[0]} · ${Math.ceil(size / 1024)} KB` });
    Object.assign(tag.style, { left: `${Math.min(x + 14, innerWidth - 260)}px`, top: `${Math.min(y + 16, innerHeight - 40)}px` });
    const slow = setTimeout(() => document.body.append(tag), 500);  // only when it takes a while
    for (const [i, f] of files.entries()) {
      try {
        const out = await (await fetch(`/file/upload?name=${encodeURIComponent(names[i])}`, { method: "POST", body: f })).json();
        if (out.path) stored.push({ name: out.path.split("/").pop(), path: out.path, size: out.size });
        else page.notice([`Could not upload ${names[i]}: ${out.error}`]);
      } catch (err) { page.notice([`Could not upload ${names[i]}: ${err}`]); }
    }
    clearTimeout(slow); tag.remove();
    if (stored.length) opened(stored[0]);  // the list has its row by now (the "file" event comes before the reply)
    if (stored.length && !panel) dropped(x, y, stored);
  }

  // Paste (Ctrl+V / ⌘V): files on the clipboard are added as if dropped where the pointer last was.
  // Text pastes as usual. A paste inside a card's app goes to that app (its own page): Chalky never hears it.
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  document.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) {  // a Linux file manager copies the file's address, not the file
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const typing = e.target.closest?.("input, textarea, [contenteditable]");
      if (!typing && /^file:\/\//.test(text.trim())) page.notice(["You copied a file's address, not the file. Drag the file onto the page instead."]);
      return;
    }
    e.preventDefault();
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    const stamp = `pasted-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    let n = 0;  // every copied image arrives as image.png
    const names = files.map((f) => (!f.name || f.name === "image.png") ? `${stamp}${n++ ? `-${n}` : ""}.${f.type.split("/")[1] || "png"}` : f.name);
    const { x, y } = pointer;
    store(files, x, y, side.contains(document.elementFromPoint(x, y)), names);
  });
}
