// The page side of the note extension. A pencil button in the tool palette (top) turns on a clear
// layer over the page; the cursor is a pen, blue over something a click would point at.
//   Click: a note box opens there.  Hold the button and draw: on release the note box opens, and the note
//   covers the drawn area (its bounding box, in main-space px: where card_show's place puts a card).
// The user sees only the box; the target goes to the agent with the note: card and block (from
// card/browser.js's data-card / data-block), the element itself (also inside app frames, which are same-origin),
// its text, the source file to edit, the spot (main-space px; on empty space the spot is the whole target),
// and the area if drawn. Enter sends it (index.ts passes it to the card's owner, gives it an id and
// tells every open page to pin it, with its drawing). Esc or the button turns it off.
// Pins: a numbered pin per note (the agents' in their colour), on the thing it is on, scrolling with the main space
// and moving with its card. Click one for its thread: who wrote what, a reply box (Enter sends it to the note's
// agent), ✓ Done; a closed note stays as a faded ✓ (Reopen, or Delete for good). An agent's reply opens the bubble while
// the note stays open. Show marks (doodle/)
// hides the pins with the other marks.
// The same note box opens for two more things (Enter on an empty box sends its faded suggestion):
//   combine  card/browser.js fires "card-combine" {a, b, x, y} when a card is dropped onto another: the note
//            says how to combine them and goes to b's owner as note_combine (b changes; a stays)
//   files    the file extension fires "file-dropped" {x, y, files} when files land on the page (from the
//            computer, or a row from its panel): a note with their paths, on what they were dropped on
// Parts: an element (or an App page's window) with partAt(x, y) is asked what is at the spot (an enemy in a
// canvas game); its answer goes with the note as "part". For a drawing, the thing under its middle is asked
// partIn(points) instead, if it has it: what is inside the drawn shape (the circled cells, paragraphs, an
// image of the area). points: [[x, y], ...] in window px (an App's window: px in its frame); it may be async.
export default async function (page) {
  let names = {};  // "block-table" -> "Table" (tags are lower case; catalog names are not)
  try { for (const n of Object.keys(await (await fetch("/card/blocks")).json())) names[`block-${n.toLowerCase()}`] = n; } catch {}

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
  input.id = "note-input";
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
    if (on) document.dispatchEvent(new CustomEvent("tool-on", { detail: "note" }));  // the other tools turn off
  };
  button.onclick = () => setOn(layer.style.display === "none");
  document.addEventListener("tool-on", (e) => { if (e.detail !== "note" && layer.style.display !== "none") setOn(false); });  // one tool at a time
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOn(false); });

  const describe = (e) => e.localName + (e.id ? `#${e.id}` : "") + (e.dataset?.name ? `[data-name="${e.dataset.name}"]` : "") +
    [...e.classList].slice(0, 2).map((c) => `.${c}`).join("");

  function inMain(x, y) {  // window px -> main-space px (the main space scrolls; card_show's place uses these)
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
    if (el === page.slot("top")) return { owner: null, card: null, blocks: [], element: "empty space in the main space",
                              text: "", file: "", position, box: new DOMRect(x - 12, y - 12, 24, 24) };
    const blocks = [];  // outermost first, e.g. ["root (Panel)", "chart1 (Table)"]
    for (let e = el.closest("[data-block]"); e; e = e.parentElement?.closest("[data-block]"))
      blocks.unshift(`${e.dataset.block} (${names[e.localName] || e.localName})`);
    const path = [];  // a short selector: up to the nearest element with an id, at most 4 steps
    for (let e = hitEl; e && path.length < 4 && e.localName !== "body"; e = e.parentElement) {
      path.unshift(describe(e));
      if (e.id) break;
    }
    const innermost = el.closest("[data-block]");
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
    const file = frame ? new URL(frame.contentWindow.location.href).pathname.slice(1)  // /built/apps/x/... is built/apps/x/...
      : innermost ? `agent/extensions/card/blocks/${names[innermost.localName] || innermost.localName}.js`
      : "agent/extensions/page/page.html (the page itself)";  // paths in the home folder (the server puts it in front)
    return {
      owner: el.closest("[data-owner]")?.dataset.owner || null,
      card: el.closest("[data-card]")?.dataset.card || null,
      blocks,
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
    openBox(x, y, { type: "note_add", target: rest, stroke: drawn, to: rest.owner });
  }

  // Combine: a card was dropped onto another (card/browser.js). The note goes to the target's owner.
  document.addEventListener("card-combine", ({ detail: { a, b, x, y } }) => {
    const to = document.querySelector(`[data-card="${CSS.escape(b)}"]`)?.dataset.owner;
    openBox(x, y, { type: "note_combine", a, b, to }, `Add ${a} to ${b}`);
  });

  // Files dropped on the page (the file extension: from the computer, or a row from its panel; already
  // stored in /workspace/drops): a note on what they landed on. Esc closes the box; the files stay stored.
  document.addEventListener("file-dropped", ({ detail: { x, y, files } }) => {
    const t = target(x, y) || { owner: null, card: null, blocks: [], element: "", text: "", file: "", position: inMain(x, y) };
    const { box, ...rest } = t;
    const paths = files.map((f) => `${f.path} (${Math.ceil(f.size / 1024)} KB)`);
    openBox(x, y, { type: "note_add", target: rest, files: paths, to: rest.owner }, `Use ${files.map((f) => f.name).join(", ")} here`);
  });

  // Press, move, release: a small movement is a click on one thing; a bigger one is a drawing.
  layer.onmousedown = (e) => {
    stroke = [[e.clientX, e.clientY]];
    input.style.display = ink.style.display = "none";
  };
  layer.onmousemove = (e) => {
    if (!stroke) {
      const t = target(e.clientX, e.clientY);
      layer.style.cursor = t && t.card ? PEN_ON : PEN;
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
    const { suggestion, x, y, stroke: drawn, ...note } = current;
    // where the pin goes, in main px (so it scrolls with the cards), and where on its card (so it moves with it)
    const at = inMain(x, y), cardEl = note.target?.card && document.querySelector(`[data-card="${CSS.escape(note.target.card)}"]`);
    const c = cardEl && inMain(cardEl.getBoundingClientRect().left, cardEl.getBoundingClientRect().top);
    page.send({ ...note, text, to: note.to || document.getElementById("to")?.value,  // else the agent picked in the chat
                board: Number(document.body.dataset.board) || 1,  // the board shown (board/): what it points at is on it
                at, ...(c && { anchor: { card: note.target.card, dx: at.x - c.x, dy: at.y - c.y } }),
                stroke: drawn ? drawn.map(([px, py]) => { const q = inMain(px, py); return [q.x, q.y]; }) : null });
    setOn(false);
  };

  // ---- pins: a numbered pin per note on the thing it is on; click it for its thread (the bubble) ----
  // A pin lives in the main space (data-board: on its board), so it scrolls with the cards. A user's note sits where
  // they clicked on its card (anchor), an agent's on the thing it named (target, found by doodle's find); else at.
  let marks = null;
  page.use("marks").then((m) => { marks = m; layout(); });
  const colour = (a) => marks?.colour(a) ?? "#0071e3";
  const css = document.createElement("style");
  css.textContent = `
    .note-pin { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 100002; }
    .note-pin > svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .note-pin > svg polyline { fill: none; stroke: #f5b700; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: .85; }
    .note-pin > .pin { position: absolute; width: 22px; height: 22px; border-radius: 50% 50% 50% 4px; display: grid; place-items: center;
      font: 600 11px/1 -apple-system, system-ui, sans-serif; color: #fff; background: var(--c); box-shadow: 0 1px 4px rgba(0, 0, 0, .3); cursor: pointer; }
    .note-pin.done > .pin { opacity: .45; }
    .note-pin.done > svg { opacity: .3; }
    .note-pin .bubble { position: absolute; width: 260px; padding: 10px 12px; border-radius: 12px; font-size: 13px; color: var(--text, #1d1d1f);
      background: var(--glass-strong, #fff); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); border: 1px solid var(--edge, #eee);
      box-shadow: 0 8px 30px rgba(0, 0, 0, .14); }
    .note-pin .bubble .entry { margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .note-pin .bubble .entry b { font-weight: 600; margin-right: 6px; }
    .note-pin .bubble .busy { color: var(--muted, #888); font-style: italic; }
    .note-pin .bubble textarea { width: 100%; box-sizing: border-box; min-height: 48px; resize: vertical; font: inherit; padding: 6px 8px;
      border-radius: 8px; border: 1px solid rgba(0, 0, 0, .15); outline: none; background: rgba(255, 255, 255, .8); }
    .note-pin .bubble .acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
    .note-pin .bubble .acts button { padding: 3px 10px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(0, 0, 0, .12); }
    .note-pin .bubble .acts button.primary { color: #fff; background: var(--accent, #0071e3); border-color: transparent; }`;
  document.head.append(css);
  const notes = {}, pins = {};  // note id -> the note; -> its element
  let openId = null, busy = {};   // the open bubble; agent -> working? (from "status")
  const drafts = {};              // note id -> what is typed in its reply box (kept when the bubble is redrawn)

  function where(id) {  // the pin's spot, main px
    const n = notes[id];
    if (n.target && marks) { const f = marks.find(n.target); const b = f.box || n.box; if (b) return { x: b.x + b.w - 4, y: b.y - 16 }; }
    if (n.target && n.box) return { x: n.box.x + n.box.w - 4, y: n.box.y - 16 };
    const card = n.anchor && document.querySelector(`[data-card="${CSS.escape(n.anchor.card)}"]`);
    if (card) { const r = card.getBoundingClientRect(), c = inMain(r.left, r.top); return { x: c.x + n.anchor.dx, y: c.y + n.anchor.dy }; }
    return n.at ?? { x: 0, y: 0 };
  }
  function draw(id) {
    const n = notes[id];
    let el = pins[id];
    if (!el) {
      el = pins[id] = Object.assign(document.createElement("div"), { className: "note-pin" });
      el.dataset.note = id;
      page.slot("top").append(el);
    }
    el.dataset.board = n.board ?? 1;
    el.classList.toggle("done", n.state !== "open");
    el.style.setProperty("--c", n.by === "user" ? "#e0a800" : colour(n.by));
    el.replaceChildren();
    const p = where(id), base = n.at ?? p;
    if (n.stroke) {  // the user's drawing, moved with the pin
      const svg = document.createElementNS(SVG, "svg"), line = document.createElementNS(SVG, "polyline");
      line.setAttribute("points", n.stroke.map(([sx, sy]) => `${sx + p.x - base.x},${sy + p.y - base.y}`).join(" "));
      svg.append(line);
      el.append(svg);
    }
    const b = Object.assign(document.createElement("button"), { className: "pin", type: "button", textContent: n.state === "open" ? id.slice(1) : "✓",
      title: `${n.thread[0]?.text ?? ""}${n.state === "open" ? "" : " (closed)"}` });
    Object.assign(b.style, { left: `${p.x}px`, top: `${p.y}px` });
    b.onclick = (e) => { e.stopPropagation(); openId = openId === id ? null : id; for (const k of Object.keys(pins)) draw(k); };
    el.append(b);
    el.dataset.at = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (openId === id) el.append(bubble(id, p));
  }
  function bubble(id, p) {
    const n = notes[id], d = Object.assign(document.createElement("div"), { className: "bubble" });
    const room = page.slot("top").scrollWidth;
    Object.assign(d.style, { left: `${Math.max(4, Math.min(room - 270, p.x - 110))}px`, top: `${p.y + 28}px` });
    for (const ev of ["pointerdown", "mousedown", "click"]) d.addEventListener(ev, (e) => e.stopPropagation());
    for (const t of n.thread) {
      const e = Object.assign(document.createElement("div"), { className: "entry" });
      const who = Object.assign(document.createElement("b"), { textContent: t.by === "user" ? "you" : t.by });
      who.style.color = t.by === "user" ? "#a07800" : colour(t.by);
      e.append(who, document.createTextNode(t.text));
      d.append(e);
    }
    if (n.state === "open" && n.thread.at(-1)?.by === "user" && busy[n.to])
      d.append(Object.assign(document.createElement("div"), { className: "entry busy", textContent: `${n.to} is working…` }));
    const acts = Object.assign(document.createElement("div"), { className: "acts" });
    const button = (text, fn, primary = false) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, className: primary ? "primary" : "" });
      b.onclick = fn;
      acts.append(b);
    };
    if (n.state === "open") {
      const ta = Object.assign(document.createElement("textarea"), { placeholder: "Reply… (Enter sends)", value: drafts[id] ?? "" });
      ta.oninput = () => { drafts[id] = ta.value; };
      const go = () => { const t = ta.value.trim(); if (t) { page.send({ type: "note_reply", id, text: t }); ta.value = drafts[id] = ""; } };
      ta.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); }
        if (e.key === "Escape") { openId = null; draw(id); }
      };
      d.append(ta);
      button("✓ Done", () => { openId = null; page.send({ type: "note_close", id }); });
      button("Reply", go, true);
      setTimeout(() => ta.focus(), 0);
    } else {
      button("Delete", () => { if (confirm("Delete this note for good?")) { openId = null; page.send({ type: "note_delete", id }); } });
      button("Reopen", () => page.send({ type: "note_reopen", id }));
    }
    d.append(acts);
    return d;
  }
  function layout() {  // things move (a card dragged, a row redrawn): pins follow
    for (const id of Object.keys(pins)) {
      const p = where(id);
      if (pins[id].dataset.at !== `${Math.round(p.x)},${Math.round(p.y)}` && openId !== id) draw(id);
    }
  }
  setInterval(layout, 1500);
  page.on("note_pin", ({ id, type, agent, ts, ...n }) => {
    const reply = notes[id] && n.thread.length > notes[id].thread.length && n.thread.at(-1).by !== "user" && n.state === "open";  // an answer still waiting on the user
    notes[id] = n;
    if (reply && openId !== id) openId = id;  // an agent answered in the thread: show it
    if (openId === id && n.state !== "open" && n.thread.at(-1)?.by !== "user") openId = null;  // and closed it: done, so out of the way
    draw(id);
  });
  page.on("note_gone", ({ id }) => { pins[id]?.remove(); delete pins[id]; delete notes[id]; });
  page.on("status", ({ agents }) => {
    const was = openId && busy[notes[openId]?.to];
    busy = Object.fromEntries(Object.entries(agents).map(([a, s]) => [a, s.state !== "idle"]));
    if (openId && pins[openId] && was !== busy[notes[openId]?.to]) draw(openId);  // only when "… is working" changes
  });
  document.addEventListener("pointerdown", (e) => {  // a click elsewhere closes the bubble
    if (openId && !e.target.closest?.(".note-pin")) { const id = openId; openId = null; if (pins[id]) draw(id); }
  });
  try { for (const [id, n] of Object.entries(await (await fetch("/note/all")).json())) { notes[id] = n; draw(id); } } catch {}
}
