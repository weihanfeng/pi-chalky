// Browser half of the viewer plugin: a preview window per file, opened by the files plugin's "file-open" DOM
// event {file: {name, path, size}} (a click on a row of the file panel, or files dropped on the page).
// A window starts attached to its row: left of the panel, at the row's height, a notch pointing at it, the row
// lit. Only one window is attached at a time (opening another file replaces it); dragging its label (shown
// on hover, like a surface's: name, ✕) or resizing it from the corner detaches it, and then it stays where
// it was put. ✕ closes it. Windows live only in this page (not saved, not seen by the agent).
// Pointing at a window with the pen: point.js asks its partAt(x, y), which answers which file and where:
// {viewing, sheet, cell} | {viewing, slide} | {viewing, paragraph} | {viewing, line} | {viewing}.
// Drawing around something: partIn(points) answers what is inside the drawn shape (a thing whose middle is
// inside it; if none, the thing under the drawing's middle), with its content, at most MAX_PICK characters:
//   sheets  {viewing, sheet, range: "B2:D5", values}       doc  {viewing, paragraphs: [{paragraph, text}]}
//   slides  {viewing, lines: [{slide, line, text}]} or {viewing, slides: [{slide, title, lines}]}
//   text    {viewing, lines: "12-18", text}                 image  {viewing, region: {x, y, width, height}, size}
//   pdf     {viewing, image: <png path>}: the browser's pdf viewer can't be read, so the page captures its own
//           tab (the browser asks once per page load to share it; the stream stays open until the page closes
//           or the user stops it), crops the frame to the drawing and saves it (POST /viewer/shot)
// The content comes from GET /viewer/view?path= (parsed in the sandbox, see viewer.py); images and pdfs
// from /viewer/raw (the browser draws them; pdf in its own viewer).
const STYLE = `
  .viewers { position: fixed; inset: 0; z-index: 15; pointer-events: none; }  /* every window, under the palette and the input */
  .viewer { position: fixed; pointer-events: auto; display: flex; flex-direction: column; width: 560px; height: min(70vh, 640px);
            min-width: 240px; min-height: 160px; box-sizing: border-box; border-radius: var(--radius, 14px); font-size: 13px;
            background: var(--glass-strong, #fff); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
            border: 1px solid var(--edge, #eee); box-shadow: var(--shadow, 0 8px 30px rgba(0,0,0,.1)); color: var(--text, #1d1d1f); --grid: rgba(128, 128, 128, .3); }
  .viewer > .viewer-label { position: absolute; bottom: 100%; left: 0; right: 0; display: flex; gap: 8px; align-items: center;
            padding: 0 2px 4px; font-size: 12px; color: var(--muted, #888); cursor: grab; opacity: 0; transition: opacity .15s;
            white-space: nowrap; overflow: hidden; }
  .viewer:hover > .viewer-label { opacity: 1; }
  .viewer > .viewer-label span { overflow: hidden; text-overflow: ellipsis; }
  .viewer > .viewer-label button { color: inherit; font: inherit; background: none; border: 0; cursor: pointer; padding: 0 2px; }
  .viewer[data-attached]::after { content: ""; position: absolute; right: -7px; top: var(--notch, 20px); width: 12px; height: 12px;
            background: inherit; border: 1px solid var(--edge, #eee); border-left: 0; border-bottom: 0; transform: rotate(45deg); }
  .viewer > .viewer-body { flex: 1; min-height: 0; overflow: auto; border-radius: inherit; }
  .viewer > .viewer-resize { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; }
  .viewer .v-pad { padding: 16px 20px; }
  .viewer .v-muted { color: var(--muted, #888); }
  .viewer img { display: block; max-width: 100%; max-height: 100%; margin: auto; object-fit: contain; }
  .viewer .v-fill { width: 100%; height: 100%; border: 0; display: block; }
  .viewer pre { margin: 0; padding: 14px 18px; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, monospace; }
  .viewer .v-doc { padding: 18px 26px; line-height: 1.55; font-size: 14px; }
  .viewer .v-doc p, .viewer .v-doc li { margin: 0 0 8px; }
  .viewer .v-doc table, .viewer .v-grid { border-collapse: collapse; }
  .viewer .v-doc table { margin: 4px 0 12px; }
  .viewer .v-doc td { border: 1px solid var(--grid); padding: 4px 8px; vertical-align: top; }
  .viewer .v-sheets { display: flex; flex-direction: column; height: 100%; }
  .viewer .v-sheet { flex: 1; min-height: 0; overflow: auto; }
  .viewer .v-grid td, .viewer .v-grid th { border: 1px solid var(--grid); padding: 3px 8px; white-space: nowrap;
            max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  .viewer .v-grid th { position: sticky; top: 0; background: var(--hover, #f2f2f2); font-weight: 500; color: var(--muted, #888); }
  .viewer .v-grid th:first-child, .viewer .v-grid td:first-child { position: sticky; left: 0; background: var(--hover, #f2f2f2);
            color: var(--muted, #888); text-align: right; }
  .viewer .v-grid th:first-child { z-index: 1; }
  .viewer .v-tabs { display: flex; gap: 2px; overflow-x: auto; padding: 0 8px; border-top: 1px solid var(--grid); }
  .viewer .v-tabs button { font: inherit; font-size: 12px; color: var(--muted, #888); background: none; border: 0; cursor: pointer;
            padding: 6px 12px; border-bottom: 2px solid transparent; white-space: nowrap; }
  .viewer .v-tabs button.on { color: var(--text, #1d1d1f); border-bottom-color: var(--accent, #0071e3); font-weight: 500; }
  .viewer .v-slides { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .viewer .v-slide { aspect-ratio: 16 / 9; box-sizing: border-box; padding: 18px 24px; border-radius: 10px; overflow: hidden;
            background: #fff; color: #1d1d1f; box-shadow: 0 1px 6px rgba(0,0,0,.12); position: relative; }
  .viewer .v-slide h2 { margin: 0 0 10px; font-size: 18px; }
  .viewer .v-slide ul { margin: 0; padding-left: 18px; }
  .viewer .v-slide .v-n { position: absolute; right: 12px; bottom: 8px; font-size: 11px; color: #999; }
  .viewer .v-notes { margin-top: -8px; font-size: 12px; }`;

function el(tag, attrs = {}, ...children) {  // textContent, never innerHTML, for anything from a file
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const MAX_PICK = 4000;  // characters of picked content sent with a note
const column = (i) => (i >= 26 ? column(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));  // 0 -> A, 26 -> AA

export default async function (page) {
  document.head.append(el("style", { text: STYLE }));
  const windows = {};  // path -> {box, file, attached}
  let top = 0;         // z-index inside the layer: the last one touched is in front
  const layer = el("div", { class: "viewers" });
  document.body.append(layer);

  const rowOf = (path) => document.querySelector(`#side .files-row[data-path="${CSS.escape(path)}"]`);

  function place(w) {  // attached: left of the panel, at the row's height (the folder button if the panel is closed)
    if (!w.attached) return;
    const row = rowOf(w.file.path);
    const visible = row && row.offsetParent;
    const anchor = visible ? row : document.querySelector("#side .files-toggle");
    if (!anchor) return;
    const a = anchor.getBoundingClientRect(), panel = (visible ? row.parentElement : anchor).getBoundingClientRect();
    const h = w.box.offsetHeight, y = Math.max(72, Math.min(a.top - 14, innerHeight - h - 16));  // 72: below the palette
    Object.assign(w.box.style, { right: `${innerWidth - panel.left + 14}px`, left: "", top: `${y}px` });
    w.box.style.setProperty("--notch", `${Math.max(10, Math.min(a.top + a.height / 2 - y - 6, h - 22))}px`);
    for (const r of document.querySelectorAll("#side .files-row.viewing")) r.classList.remove("viewing");
    if (visible) row.classList.add("viewing");
  }
  const placeAll = () => Object.values(windows).forEach(place);
  addEventListener("resize", placeAll);
  document.addEventListener("scroll", placeAll, true);  // the panel's list scrolls
  const side = document.getElementById("side");
  if (side) new MutationObserver(() => {  // the list redrawn or the panel opened or closed
    for (const w of Object.values(windows)) if (!rowOf(w.file.path) && w.attached && side.querySelector(".files-row")) close(w);  // file gone
    placeAll();
  }).observe(side, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open", "hidden"] });

  function detach(w) {
    if (!w.attached) return;
    const r = w.box.getBoundingClientRect();
    Object.assign(w.box.style, { left: `${r.left}px`, top: `${r.top}px`, right: "" });
    w.attached = false;
    w.box.removeAttribute("data-attached");
    rowOf(w.file.path)?.classList.remove("viewing");
  }

  function close(w) {
    w.box.remove();
    delete windows[w.file.path];
    if (w.attached) rowOf(w.file.path)?.classList.remove("viewing");
  }

  function dragging(w, e, move) {  // pointer capture, so moves over iframes (a pdf) still arrive
    if (e.target.closest("button")) return;
    e.preventDefault();
    detach(w);
    const handle = e.currentTarget, r = w.box.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = (ev) => move(r, ev.clientX - x0, ev.clientY - y0);
    handle.onpointerup = () => { handle.onpointermove = handle.onpointerup = null; };
  }

  function open(file) {
    const old = windows[file.path];
    if (old) { old.box.style.zIndex = ++top; return; }
    for (const w of Object.values(windows)) if (w.attached) close(w);  // one attached window at a time
    const body = el("div", { class: "viewer-body" }, el("div", { class: "v-pad v-muted", text: "Opening…" }));
    const box = el("div", { class: "viewer", "data-attached": "" });
    const w = { box, file, attached: true };
    const label = el("div", { class: "viewer-label", title: "Drag to move" },
      el("span", { text: file.name }), el("button", { text: "✕", title: "Close", onclick: () => close(w) }));
    const corner = el("div", { class: "viewer-resize", title: "Drag to resize" });
    box.append(label, body, corner);
    box.onpointerdown = () => { box.style.zIndex = ++top; };
    label.onpointerdown = (e) => dragging(w, e, (r, dx, dy) => Object.assign(box.style, {
      left: `${Math.max(0, Math.min(r.left + dx, innerWidth - 60))}px`, top: `${Math.max(24, Math.min(r.top + dy, innerHeight - 40))}px` }));
    corner.onpointerdown = (e) => dragging(w, e, (r, dx, dy) => Object.assign(box.style, {
      width: `${Math.max(240, r.width + dx)}px`, height: `${Math.max(160, r.height + dy)}px` }));
    box.partAt = (x, y) => {  // for point.js: which file, and where in it
      const r = box.getBoundingClientRect();
      const hit = document.elementsFromPoint(r.left + x, r.top + y).find((e) => box.contains(e));
      const spot = hit?.closest("[data-part]");
      return { viewing: file.path, ...(spot ? JSON.parse(spot.dataset.part) : {}) };
    };
    box.style.zIndex = ++top;
    windows[file.path] = w;
    layer.append(box);
    place(w);
    box.partIn = (points) => pick(w, points);
    fill(w, body, file);
  }

  async function fill(w, body, file) {
    const q = `?path=${encodeURIComponent(file.path)}`;
    let p;
    try { p = await (await fetch(`/viewer/view${q}`)).json(); } catch (e) { p = { kind: "none", reason: `Could not load: ${e}` }; }
    w.p = p;
    const part = (o) => JSON.stringify(o);
    let content;
    if (p.kind === "image") content = el("div", { class: "v-fill", style: "display:grid;place-items:center;padding:10px;box-sizing:border-box" },
      el("img", { src: `/viewer/raw${q}`, alt: file.name }));
    else if (p.kind === "pdf") content = el("iframe", { class: "v-fill", src: `/viewer/raw${q}`, title: file.name });
    else if (p.kind === "text") content = el("pre", {}, ...p.text.split("\n").map((t, i) => el("span", { "data-part": part({ line: i + 1 }), text: t + "\n" })),
      ...(p.cut ? [el("span", { class: "v-muted", text: "… (cut: the file is longer)" })] : []));
    else if (p.kind === "doc") content = el("div", { class: "v-doc" }, ...docBlocks(p.blocks, part));
    else if (p.kind === "slides") content = el("div", { class: "v-slides" }, ...p.slides.flatMap((s, i) => [
      el("div", { class: "v-slide", "data-part": part({ slide: i + 1 }) },
        el("h2", { text: s.title, "data-part": part({ slide: i + 1, line: 0 }) }),
        el("ul", {}, ...s.lines.map((t, j) => el("li", { "data-part": part({ slide: i + 1, line: j + 1 }), text: t }))),
        el("span", { class: "v-n", text: `${i + 1} / ${p.slides.length}` })),
      ...(s.notes ? [el("div", { class: "v-notes v-muted", text: `Notes: ${s.notes}` })] : [])]));
    else if (p.kind === "sheets") content = sheets(w, p.sheets, part);
    else content = el("div", { class: "v-pad v-muted", text: p.reason || p.error || "No preview." });
    body.replaceChildren(content);
  }

  function docBlocks(blocks, part) {  // headings, paragraphs, runs of list items as one list, tables
    const out = [];
    let list = null;
    blocks.forEach((b, i) => {
      const at = { "data-part": part({ paragraph: i + 1 }) };
      if (b.item) { if (!list) out.push(list = el("ul")); list.append(el("li", { ...at, text: b.text })); return; }
      list = null;
      if (b.table) out.push(el("table", at, ...b.table.map((r) => el("tr", {}, ...r.map((c) => el("td", { text: c }))))));
      else out.push(el(b.heading ? `h${Math.min(b.heading + 1, 6)}` : "p", { ...at, text: b.text }));
    });
    return out.length ? out : [el("p", { class: "v-muted", text: "(empty document)" })];
  }

  function sheets(w, list, part) {  // one grid at a time, its sheets as tabs along the bottom (like Excel)
    const view = el("div", { class: "v-sheet" });
    const tabs = el("div", { class: "v-tabs" });
    const show = (k) => {
      w.sheet = k;
      const s = list[k];
      const width = Math.max(0, ...s.rows.map((r) => r.length));
      const head = el("tr", {}, el("th"), ...Array.from({ length: width }, (_, c) => el("th", { text: column(c) })));
      const rows = s.rows.map((r, i) => el("tr", {}, el("td", { text: String(i + 1) }),
        ...Array.from({ length: width }, (_, c) => el("td", { "data-part": part({ sheet: s.name, cell: `${column(c)}${i + 1}` }), text: r[c] ?? "", title: r[c] ?? "" }))));
      view.replaceChildren(rows.length ? el("table", { class: "v-grid" }, head, ...rows) : el("div", { class: "v-pad v-muted", text: "(empty sheet)" }),
        ...(s.cut ? [el("div", { class: "v-pad v-muted", text: "Only the first rows and columns are shown." })] : []));
      [...tabs.children].forEach((t, j) => t.classList.toggle("on", j === k));
    };
    list.forEach((s, k) => tabs.append(el("button", { text: s.name, onclick: () => show(k) })));
    show(0);
    return el("div", { class: "v-sheets" }, view, tabs);
  }

  // Drawn around (partIn): what is inside the drawing. inShape: is (x, y) inside the polygon (ray casting).
  const inShape = (pts, x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const bounds = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };
  const fit = (list, size) => {  // as many items as fit in MAX_PICK characters
    const out = [];
    let n = 0;
    for (const x of list) { n += size(x); if (n > MAX_PICK && out.length) break; out.push(x); }
    return { list: out, cut: out.length < list.length };
  };
  const cellAt = (ref) => { const [, c, r] = ref.match(/^([A-Z]+)(\d+)$/); return [[...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, +r - 1]; };

  async function pick(w, points) {
    const base = { viewing: w.file.path }, kind = w.p?.kind;
    if (kind === "pdf") return { ...base, ...(await capture(w, points)) };
    const b = bounds(points);
    if (kind === "image") {
      const img = w.box.querySelector("img"), r = img.getBoundingClientRect(), k = img.naturalWidth / r.width;
      const x0 = Math.max(b.left, r.left), y0 = Math.max(b.top, r.top), x1 = Math.min(b.right, r.right), y1 = Math.min(b.bottom, r.bottom);
      if (x1 <= x0 || y1 <= y0) return base;
      return { ...base, region: { x: Math.round((x0 - r.left) * k), y: Math.round((y0 - r.top) * k),
        width: Math.round((x1 - x0) * k), height: Math.round((y1 - y0) * k) }, size: [img.naturalWidth, img.naturalHeight] };
    }
    const view = w.box.querySelector(".viewer-body").getBoundingClientRect();
    let picked = [...w.box.querySelectorAll("[data-part]")].filter((e) => {  // its middle inside the drawing (and in view)
      const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return r.width && x >= view.left && x <= view.right && y >= view.top && y <= view.bottom && inShape(points, x, y);
    });
    if (!picked.length) {  // a drawing inside one big thing (a long paragraph): that thing
      const mid = document.elementsFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2).find((e) => w.box.contains(e))?.closest("[data-part]");
      picked = mid ? [mid] : [];
    }
    const parts = picked.map((e) => JSON.parse(e.dataset.part));
    if (!parts.length) return base;
    if (kind === "sheets") {
      const s = w.p.sheets[w.sheet ?? 0], at = parts.map((q) => cellAt(q.cell));
      const c0 = Math.min(...at.map((a) => a[0])), c1 = Math.max(...at.map((a) => a[0]));
      const r0 = Math.min(...at.map((a) => a[1])), r1 = Math.max(...at.map((a) => a[1]));
      const rows = fit(s.rows.slice(r0, r1 + 1).map((r) => r.slice(c0, c1 + 1)), (r) => r.join(",").length + 1);
      return { ...base, sheet: s.name, range: `${column(c0)}${r0 + 1}:${column(c1)}${r1 + 1}`, values: rows.list, ...(rows.cut && { cut: true }) };
    }
    if (kind === "doc") {
      const text = (bl) => bl.table ? bl.table.map((r) => r.join(" | ")).join("\n") : bl.text;
      const ps = fit(parts.map((q) => ({ paragraph: q.paragraph, text: text(w.p.blocks[q.paragraph - 1]) })), (x) => x.text.length);
      return { ...base, paragraphs: ps.list, ...(ps.cut && { cut: true }) };
    }
    if (kind === "slides") {
      const slide = (n) => w.p.slides[n - 1];
      const lines = parts.filter((q) => q.line !== undefined);
      if (lines.length) {
        const ls = fit(lines.map((q) => ({ slide: q.slide, line: q.line, text: q.line ? slide(q.slide).lines[q.line - 1] : slide(q.slide).title })), (x) => x.text.length);
        return { ...base, lines: ls.list, ...(ls.cut && { cut: true }) };
      }
      const ss = fit(parts.map((q) => ({ slide: q.slide, title: slide(q.slide).title, lines: slide(q.slide).lines })), (x) => JSON.stringify(x).length);
      return { ...base, slides: ss.list, ...(ss.cut && { cut: true }) };
    }
    if (kind === "text") {
      const n = parts.map((q) => q.line), lo = Math.min(...n), hi = Math.max(...n);
      const text = w.p.text.split("\n").slice(lo - 1, hi).join("\n");
      return { ...base, lines: lo === hi ? `${lo}` : `${lo}-${hi}`, text: text.length > MAX_PICK ? text.slice(0, MAX_PICK) + " …(cut)" : text };
    }
    return base;
  }

  let stream = null, video = null;  // this tab, shared once (pdf pictures)
  async function capture(w, points) {
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true, selfBrowserSurface: "include" });
        stream.getVideoTracks()[0].onended = () => { stream = null; video?.remove(); };  // the user stopped sharing
        video = el("video", { muted: "", playsinline: "", style: "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none" });
        video.srcObject = stream;
        document.body.append(video);
        await video.play();
      }
      await new Promise((ok) => setTimeout(ok, 250));  // a fresh frame, with the drawing on it
      const f = w.box.querySelector("iframe").getBoundingClientRect(), b = bounds(points), pad = 8;
      const x0 = Math.max(f.left, b.left - pad), y0 = Math.max(f.top, b.top - pad);
      const x1 = Math.min(f.right, b.right + pad), y1 = Math.min(f.bottom, b.bottom + pad);
      if (x1 <= x0 || y1 <= y0) return {};
      const kx = video.videoWidth / innerWidth, ky = video.videoHeight / innerHeight;  // frame px per window px
      const c = el("canvas", { width: Math.round((x1 - x0) * kx), height: Math.round((y1 - y0) * ky) });
      c.getContext("2d").drawImage(video, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, 0, 0, c.width, c.height);
      const png = await new Promise((ok) => c.toBlob(ok, "image/png"));
      const out = await (await fetch("/viewer/shot", { method: "POST", body: png })).json();
      return out.path ? { image: out.path } : { image: null, why: out.error };
    } catch (e) {
      return { image: null, why: `no picture of the area (${e.name || e}): the tab was not shared` };
    }
  }

  document.addEventListener("file-open", (e) => open(e.detail.file));
}
