// Browser half of the point plugin (experiment). A pencil button in the tool palette (top) turns on a clear
// layer over the page; the cursor is a pen, blue over something a click would point at.
//   Click: a note box opens there.  Hold the button and draw: on release the note box opens, and the note
//   covers the drawn area (its bounding box, in main-space px: where ui_render's place puts a surface).
// The user sees only the box; the target goes to the agent with the note: surface and component (from
// ui.js's data-surface / data-cid), the element itself (also inside App frames, which are same-origin),
// its text, the source file to edit, the spot (main-space px; on empty space the spot is the whole target),
// and the area if drawn. Enter sends it (point.py passes it to the surface's owner, gives it an id and
// tells every open page to pin it, with its drawing). The pin fades when the agent marks the note
// done (event "point_done") or the user closes it with its ✕; open notes are redrawn after a reload.
// Esc or the button turns it off.
// The same note box opens for two more things (Enter on an empty box sends its faded suggestion):
//   combine  ui.js fires "ui-combine" {a, b, x, y} when a surface is dropped onto another: the note
//            says how to combine them and goes to b's owner as point_combine (b changes; a stays)
//   files    the files plugin fires "files-dropped" {x, y, files} when files land on the page (from the
//            computer, or a row from its panel): a note with their paths, on what they were dropped on
// Parts: an element (or an App page's window) with partAt(x, y) is asked what is at the spot (an enemy in a
// canvas game); its answer goes with the note as "part". For a drawing, the thing under its middle is asked
// partIn(points) instead, if it has it: what is inside the drawn shape (the circled cells, paragraphs, an
// image of the area). points: [[x, y], ...] in window px (an App's window: px in its frame); it may be async.
export default async function (page) {
  let names = {};  // "ui-table" -> "Table" (tags are lower case; catalog names are not)
  try { for (const n of Object.keys(await (await fetch("/ui-api/catalog")).json())) names[`ui-${n.toLowerCase()}`] = n; } catch {}

  const layer = document.createElement("div");  // catches clicks, so the page underneath doesn't react
  layer.style.cssText = "position:fixed;inset:0;z-index:9998;display:none";
  // The cursor: the button's pen (white edge, so it shows on dark too), its tip (4, 20) is the spot pointed at.
  const pen = (color) => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#fff" stroke-width="4"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></g>` +
    `<g stroke="${color}" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></g></svg>`)}") 4 20, crosshair`;
  const PEN = pen("#6e6e73"), PEN_ON = pen("#0071e3");  // grey: empty space; blue: over a thing
  layer.style.cursor = PEN;
  const input = document.createElement("input");  // the note box, opened where the user clicked
  input.id = "point-note";
  input.placeholder = "Write a note, Enter to send";
  input.style.cssText = "position:fixed;z-index:9999;width:280px;box-sizing:border-box;font:inherit;font-size:14px;" +
    "padding:8px 12px;border-radius:12px;outline:none;color:#1d1d1f;background:var(--glass-strong,#fff);" +  // the page's glass
    "backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--edge,#eee);" +
    "box-shadow:0 8px 30px rgba(0,0,0,.1);display:none";
  const SVG = "http://www.w3.org/2000/svg";
  function strokeSvg(points) {  // a freehand stroke, drawn over the whole window (fixed, like the pins)
    const svg = document.createElementNS(SVG, "svg");
    svg.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none";
    const line = document.createElementNS(SVG, "polyline");
    line.style.cssText = "fill:none;stroke:#f5b700;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:.85";
    line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
    svg.append(line);
    return svg;
  }
  const ink = strokeSvg([]);  // the stroke being drawn
  ink.style.zIndex = 9999;
  ink.style.display = "none";
  let current = null;  // {target, x, y, stroke} of the open note
  let stroke = null;   // [[x, y], ...] while the mouse button is held down
  document.body.append(layer, ink, input);

  const button = document.createElement("button");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></svg>`;
  button.title = "Point: click anything, or hold and draw around an area, then write a note (Esc to stop)";
  page.slot("status").prepend(button);  // the first tool in the palette, whichever script loads first
  const setOn = (on) => {
    layer.style.display = on ? "block" : "none";
    button.classList.toggle("on", on);
    if (!on) input.style.display = ink.style.display = "none";
    if (!on) current = stroke = null;
    if (on) document.dispatchEvent(new CustomEvent("tool-on", { detail: "point" }));  // the other tools turn off
  };
  button.onclick = () => setOn(layer.style.display === "none");
  document.addEventListener("tool-on", (e) => { if (e.detail !== "point" && layer.style.display !== "none") setOn(false); });  // one tool at a time
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOn(false); });

  const describe = (e) => e.localName + (e.id ? `#${e.id}` : "") + (e.dataset?.name ? `[data-name="${e.dataset.name}"]` : "") +
    [...e.classList].slice(0, 2).map((c) => `.${c}`).join("");

  function inMain(x, y) {  // window px -> main-space px (the main space scrolls; ui_render's place uses these)
    const main = page.slot("top"), m = main.getBoundingClientRect();
    return { x: Math.round(x - m.left + main.scrollLeft), y: Math.round(y - m.top + main.scrollTop) };
  }

  function target(x, y) {
    const el = document.elementsFromPoint(x, y).find((e) => e !== layer);
    if (!el) return null;
    let inner = null, frame = null, box = el.getBoundingClientRect();
    if (el.localName === "iframe") {  // look inside the frame (an App): same origin, so its document is readable
      try {
        const r = el.getBoundingClientRect(), dx = r.left + el.clientLeft, dy = r.top + el.clientTop;
        inner = el.contentDocument?.elementFromPoint(x - dx, y - dy);
        if (inner) { frame = el; const b = inner.getBoundingClientRect(); box = new DOMRect(b.x + dx, b.y + dy, b.width, b.height); }
      } catch {}
    }
    const hitEl = inner || el;
    const position = inMain(x, y);
    if (el === page.slot("top")) return { owner: null, surface: null, components: [], element: "empty space in the main space",
                              text: "", file: "", position, box: new DOMRect(x - 12, y - 12, 24, 24) };
    const components = [];  // outermost first, e.g. ["root (Card)", "chart1 (Table)"]
    for (let e = el.closest("[data-cid]"); e; e = e.parentElement?.closest("[data-cid]"))
      components.unshift(`${e.dataset.cid} (${names[e.localName] || e.localName})`);
    const path = [];  // a short selector: up to the nearest element with an id, at most 4 steps
    for (let e = hitEl; e && path.length < 4 && e.localName !== "body"; e = e.parentElement) {
      path.unshift(describe(e));
      if (e.id) break;
    }
    const innermost = el.closest("[data-cid]");
    let part = null;  // what the thing itself says is at this spot (partAt), e.g. {"name": "enemy-2"}
    try {
      if (frame?.contentWindow?.partAt) {
        const r = frame.getBoundingClientRect();
        part = frame.contentWindow.partAt(x - r.left - frame.clientLeft, y - r.top - frame.clientTop);
      } else {
        const owner = [hitEl, ...[...document.elementsFromPoint(x, y)]].find((e) => typeof e?.partAt === "function");
        if (owner) { const r = owner.getBoundingClientRect(); part = owner.partAt(x - r.left, y - r.top); }
      }
    } catch (e) { console.warn("partAt:", e); }
    const file = frame ? "/app" + new URL(frame.contentWindow.location.href).pathname  // /ui/apps/x/... -> /app/ui/apps/x/...
      : innermost ? `/app/extensions/ui/components/${names[innermost.localName] || innermost.localName}.js`
      : "/app/extensions/page/page.html (the page itself)";  // /app/: the code folder (the server puts in the real one)
    return {
      owner: el.closest("[data-owner]")?.dataset.owner || null,
      surface: el.closest("[data-surface]")?.dataset.surface || null,
      components,
      element: path.join(" > "),
      part,
      text: (hitEl.innerText || hitEl.value || hitEl.alt || "").trim().replace(/\s+/g, " ").slice(0, 60),
      file,
      at: { x: Math.round(((x - box.x) / box.width) * 100) + "%", y: Math.round(((y - box.y) / box.height) * 100) + "%" },
      position,
      box,
    };
  }

  // The note box at (x, y). `note`: what Enter sends besides the text (target, combine, files);
  // `suggestion`: the faded text, sent as it is if the box is left empty (else the box needs words).
  function openBox(x, y, note, suggestion = "") {
    input.style.display = "block";
    input.style.left = Math.min(x + 12, innerWidth - input.offsetWidth - 8) + "px";
    input.style.top = Math.min(y + 12, innerHeight - input.offsetHeight - 8) + "px";
    input.placeholder = suggestion || "Write a note, Enter to send";
    current = { x, y, suggestion, ...note };
    input.value = "";
    input.focus();
  }

  function openNote(t, x, y, drawn = null) {  // a note on target t (and the drawn stroke)
    if (!t) return;
    const { box, ...rest } = t;
    openBox(x, y, { type: "point_note", target: rest, stroke: drawn, to: rest.owner });
  }

  // Combine: a surface was dropped onto another (ui.js). The note goes to the target's owner.
  document.addEventListener("ui-combine", ({ detail: { a, b, x, y } }) => {
    const to = document.querySelector(`[data-surface="${CSS.escape(b)}"]`)?.dataset.owner;
    openBox(x, y, { type: "point_combine", a, b, to }, `Add ${a} to ${b}`);
  });

  // Files dropped on the page (the files plugin: from the computer, or a row from its panel; already
  // stored in /workspace/drops): a note on what they landed on. Esc closes the box; the files stay stored.
  document.addEventListener("files-dropped", ({ detail: { x, y, files } }) => {
    const t = target(x, y) || { owner: null, surface: null, components: [], element: "", text: "", file: "", position: inMain(x, y) };
    const { box, ...rest } = t;
    const paths = files.map((f) => `${f.path} (${Math.ceil(f.size / 1024)} KB)`);
    openBox(x, y, { type: "point_note", target: rest, files: paths, to: rest.owner }, `Use ${files.map((f) => f.name).join(", ")} here`);
  });

  // Press, move, release: a small movement is a click on one thing; a bigger one is a drawing.
  layer.onmousedown = (e) => {
    stroke = [[e.clientX, e.clientY]];
    input.style.display = ink.style.display = "none";
  };
  layer.onmousemove = (e) => {
    if (!stroke) {
      const t = target(e.clientX, e.clientY);
      layer.style.cursor = t && t.surface ? PEN_ON : PEN;
      return;
    }
    const [lx, ly] = stroke.at(-1);
    if (Math.hypot(e.clientX - lx, e.clientY - ly) < 3) return;  // keep the stroke light
    stroke.push([e.clientX, e.clientY]);
    ink.style.display = "block";
    ink.firstChild.setAttribute("points", stroke.map((p) => p.join(",")).join(" "));
  };
  async function partIn(x, y, points) {  // what the thing at (x, y) says is inside the drawing, or null
    const el = document.elementsFromPoint(x, y).find((e) => e !== layer && e !== ink);
    if (el?.localName === "iframe") {
      try {
        const r = el.getBoundingClientRect(), dx = r.left + el.clientLeft, dy = r.top + el.clientTop;
        if (typeof el.contentWindow.partIn === "function") return await el.contentWindow.partIn(points.map(([px, py]) => [px - dx, py - dy]));
      } catch (err) { console.warn("partIn:", err); }
    }
    const owner = document.elementsFromPoint(x, y).find((e) => typeof e.partIn === "function");
    try { return owner ? await owner.partIn(points) : null; } catch (err) { console.warn("partIn:", err); return null; }
  }

  layer.onmouseup = async (e) => {
    const points = stroke;
    stroke = null;
    if (!points) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    if (width < 12 && height < 12) return openNote(target(e.clientX, e.clientY), e.clientX, e.clientY);
    const t = target(left + width / 2, top + height / 2);  // what is under the middle of the drawing
    if (t) t.area = { ...inMain(left, top), width: Math.round(width), height: Math.round(height) };
    const inside = t && (await partIn(left + width / 2, top + height / 2, points));
    if (inside) t.part = inside;
    openNote(t, e.clientX, e.clientY, points);
  };

  input.onkeydown = (e) => {
    const text = input.value.trim() || current?.suggestion;
    if (e.key !== "Enter" || !text || !current) return;
    const { suggestion, ...note } = current;
    page.send({ ...note, text, to: note.to || document.getElementById("to")?.value });  // else the agent picked in the chat
    setOn(false);
  };

  const pins = {};  // note id -> pin element: its label, and its drawing if it has one
  function pin({ id, text, to, x, y, stroke }) {  // stays where the note was written (doesn't follow scrolling yet)
    if (pins[id]) return;
    const el = (pins[id] = document.createElement("div"));
    el.style.cssText = "position:fixed;inset:0;z-index:9997;pointer-events:none;transition:opacity 1.5s";
    if (stroke) el.append(strokeSvg(stroke));
    const label = document.createElement("div");
    label.style.cssText = `position:absolute;left:${x}px;top:${y}px;max-width:240px;` +
      "background:#fff8c4;border:1px solid #e6c200;border-radius:4px;padding:3px 20px 3px 6px;font:12px sans-serif;" +
      "box-shadow:0 1px 3px #0003";
    label.textContent = `✎ ${text} · sent to ${to}`;
    const close = document.createElement("button");
    close.textContent = "✕";
    close.title = "Close this note (its agent is told)";
    close.style.cssText = "position:absolute;top:1px;right:3px;line-height:1;pointer-events:auto;border:0;background:none;cursor:pointer;padding:0 2px;font:inherit;color:#8a7400";
    close.onclick = () => page.send({ type: "point_dismiss", id });
    label.append(close);
    el.append(label);
    document.body.append(el);
  }
  page.on("point_pin", pin);
  page.on("point_done", ({ id }) => {
    const el = pins[id];
    if (!el) return;
    delete pins[id];
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 1500);
  });
  try { for (const [id, n] of Object.entries(await (await fetch("/point/notes")).json())) pin({ id, ...n }); } catch {}
}
