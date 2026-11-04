// The page side of the doodle extension: three tools in the palette, a marker, Text and an eraser. The marker and
// Text can be on together; the eraser (like any other tool) turns them off.
//   marker  drag draws on the page, over cards and inside app frames (same-origin). A press that doesn't move
//           is an ordinary click, so double and triple clicks still select text. Typing with the pointer over the
//           page and no text box focused puts words in handwriting there.
//   Text    (T) every click puts words in handwriting there; Enter or a click elsewhere ends them. With the
//           marker on too, a drag draws and a click writes.
//   eraser  press or drag over a line or words (also saved ones, the agents' too: for good) to take them away whole; it also says "erase" (a page event,
//           {x, y} in main-space px) so other tools take theirs away (frames: an unsent frame).
//   click   with the marker (Text off) works the page as usual. If there is drawing, it first becomes a step: a picture of the screen
//           as it was when the button went down (before the click acts), cropped to the drawing, and the
//           ink clears. The drawing goes only as the picture; typed words also go as text, exactly. Clicks
//           are written down as words, between the steps.
//   box     a moment after the user stops drawing, a box by the last mark asks for words: Enter there sends (sendAll).
//           Drawing again tucks it away; Esc closes it. Ctrl+Enter anywhere also sends.
//   Enter   in the message line (also with the marker off) sends the steps, the drawing still on the page and
//           the words typed there, together: doodle_send, to the agent picked in the chat. The drawing still on the
//           page stays there, saved, as a group (each mark with what the page can tell about it from geometry: say()).
//   groups  the shared board (the last part of this file): saved groups, the user's and the agents' marks (an agent's
//           gesture is drawn by hand from what it names: find()), a ✓ chip per group to clear it, answered groups dim,
//           a cleared group comes back from the chat log (hover: a ghost; click: back). Nothing clears by itself.
//   show    one switch (the eye) hides or shows every mark: doodles, words, the agents' marks, note pins, chips.
//   boards  going to another board (board/) is like a click: the drawing so far becomes a step, then "went to
//           board N". Each step says the board it was drawn on.
// Things with a drag of their own keep it: a card's label (moves it), its resize corner, lists to pick from,
// sliders, draggable things, frames; text boxes don't (a drag that starts on one draws). Ctrl+Z takes back
// the last mark; Esc turns the tools off (ink stays).
// Pictures: the tab is shared once (the screen extension), when the marker or Text is first turned on; without
// it, steps go as words only. The steps so far show in the message line ("1 → ☆ Week 2 · 2 marks"): hover one for its picture, click it to see it big, ✕ drops it.
// Ink and words live in the main space (slot "top"), in main-space px, so they scroll with the cards.
export default async function (page) {
  const area = page.slot("top");
  const form = document.getElementById("f"), input = document.getElementById("text");
  const SVG = "http://www.w3.org/2000/svg", INK = "#e5397a";
  // The cursor: a marker (white edge, so it shows on dark too); its tip (3, 21) is where the line starts.
  const PEN = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="${SVG}" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21l1.6-5.2L16.2 4.2a2.2 2.2 0 013.1 3.1L7.7 18.9z" ` +
    `fill="#fff" stroke="#1d1d1f" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 21l1.6-5.2 3.1 3.1z" fill="${INK}"/></svg>`)}") 3 21, crosshair`;
  const RUB = `url("data:image/svg+xml,${encodeURIComponent(  // the eraser cursor; its bottom-left edge (5, 20) rubs
    `<svg xmlns="${SVG}" width="24" height="24" viewBox="0 0 24 24"><path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0` +
    `l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21z" fill="#fff" stroke="#1d1d1f" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4L7.5 8.5l9 9L13 21z" fill="${INK}"/></svg>`)}") 5 20, crosshair`;
  const CURSORS = `
    .doodling, .doodling * { cursor: ${PEN}; }
    .doodling :is(button, a, select, summary, label, [onclick], [role="button"], [role="tab"], .card-label) { cursor: pointer; }
    .doodling :is(input, textarea, [contenteditable="true"]) { cursor: text; }
    .doodling .card-resize { cursor: nwse-resize; }
    .doodle-text:not(.doodling), .doodle-text:not(.doodling) * { cursor: text !important; }
    .doodle-erase, .doodle-erase * { cursor: ${RUB} !important; }`;
  const style = document.createElement("style");
  style.textContent = CURSORS + `
    #top:is(.doodling, .doodle-text, .doodle-erase) { z-index: 11; }  /* above the messages panel (10), so lines can go there too */
    #top > svg.doodle-ink { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; z-index: 100001; pointer-events: none; }
    #top > svg.doodle-ink path { fill: none; stroke: ${INK}; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    #top > .doodle-note { position: absolute; z-index: 100001; font: 20px/1.2 "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive; color: ${INK};
                          white-space: pre; outline: none; pointer-events: none; padding: 0 4px; min-width: 8px; }
    #top > .doodle-note:empty::before { content: "type here…"; opacity: .5; }
    #top > .doodle-note[contenteditable="true"] { pointer-events: auto; background: rgba(229, 57, 122, .1); border-radius: 6px; caret-color: ${INK}; }
    #f .doodle-strip { display: flex; align-items: center; gap: 4px; flex: none; max-width: 45%; overflow-x: auto; }
    #f .doodle-strip:empty { display: none; }
    #f .doodle-chip { position: relative; flex: none; min-width: 24px; height: 24px; padding: 0 7px; box-sizing: border-box; border-radius: 7px;
                      display: grid; place-items: center; font-size: 12px; font-weight: 600; color: ${INK}; border: 1.5px solid ${INK};
                      background: rgba(229, 57, 122, .08); cursor: default; }
    #f .doodle-chip.now { border-style: dashed; background: none; font-weight: 500; }
    #f .doodle-chip .x { position: absolute; right: -6px; top: -6px; width: 14px; height: 14px; border-radius: 50%; background: var(--text);
                         color: #fff; font-size: 9px; line-height: 14px; text-align: center; display: none; cursor: pointer; }
    #f .doodle-chip:hover .x { display: block; }
    #f .doodle-click { flex: none; font-size: 12px; color: var(--muted); white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
    .doodle-peek { position: fixed; z-index: 100; max-width: 360px; padding: 6px; border-radius: 12px; background: var(--glass-strong, #fff);
                   border: 1px solid var(--edge, #eee); box-shadow: 0 8px 30px rgba(0, 0, 0, .12); font-size: 12px; color: var(--muted); pointer-events: none; }
    .doodle-peek img { display: block; max-width: 100%; max-height: 220px; border-radius: 6px; margin-bottom: 4px; }
    #f .doodle-chip:not(.now) { cursor: zoom-in; }
    .doodle-big { position: fixed; inset: 0; z-index: 200; display: grid; place-content: center; justify-items: center; gap: 10px;
                  background: rgba(0, 0, 0, .55); cursor: zoom-out; color: #fff; font-size: 13px; }
    .doodle-big div { padding: 4px 12px; border-radius: 999px; background: rgba(0, 0, 0, .6); }
    .doodle-big img { max-width: 92vw; max-height: 84vh; border-radius: 10px; box-shadow: 0 20px 60px rgba(0, 0, 0, .4); background: #fff; }
    .doodle-group { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 100000; pointer-events: none; transition: opacity .8s; }
    .doodle-group svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }
    .doodle-group path { fill: none; stroke: var(--ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .doodle-group .words { position: absolute; font: 20px/1.2 "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive; color: var(--ink);
                           white-space: pre; padding: 0 4px; }
    .doodle-group .words.agent { font-size: 17px; background: rgba(255, 255, 255, .7); border-radius: 6px; }
    .doodle-group .chip { position: absolute; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; pointer-events: auto;
                          font-size: 12px; color: #fff; background: #1d1d1f; box-shadow: 0 1px 4px rgba(0, 0, 0, .25); cursor: pointer; opacity: .55; }
    .doodle-group .chip:hover { opacity: 1; }
    .doodle-group.dim { opacity: .35; }
    .doodle-group.gone { opacity: 0; }
    .doodle-group.ghost { opacity: .4; }
    .doodle-group.ghost path { stroke-dasharray: 6 5; }
    .doodle-group.ghost .chip { display: none; }
    body.marks-hidden :is(.doodle-group, svg.doodle-ink, .doodle-note, .note-pin) { display: none !important; }
    #top > .doodle-ask { position: absolute; z-index: 100003; width: 300px; box-sizing: border-box; display: flex; gap: 6px; align-items: center; padding: 6px 6px 6px 12px;
      border-radius: 12px; background: var(--glass-strong, #fff); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      border: 1px solid ${INK}; box-shadow: 0 8px 30px rgba(0, 0, 0, .12); animation: doodle-ask .25s ease-out; cursor: auto; }
    #top > .doodle-ask input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: 14px; color: var(--text, #1d1d1f); }
    #top > .doodle-ask button { width: 28px; height: 28px; border-radius: 50%; border: 0; background: ${INK}; color: #fff; font-size: 15px; cursor: pointer; }
    @keyframes doodle-ask { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { #top > .doodle-ask { animation: none; } }
    #log [data-raw].doodle-back, #log .note.doodle-back { cursor: pointer; text-decoration: underline dotted; }`;
  document.head.append(style);

  const button = document.createElement("button");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c3-6 5-6 7-2s4 4 7-3 3-5 4-4"/></svg>`;
  button.title = "Doodle: drag to draw, type to write, click to use the page; then Enter in the message line sends it all (Esc to stop)";
  const textButton = document.createElement("button");
  textButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>`;
  textButton.title = "Text: click where the words go (Enter to finish); sent with the doodles, Enter in the message line (Esc to stop)";
  const eraseButton = document.createElement("button");
  eraseButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0` +
    `l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`;
  eraseButton.title = "Eraser: press or drag over lines, words or unsent frames to take them away (Esc to stop)";
  const showButton = document.createElement("button");  // one switch for every mark: doodles, words, the agents' marks, note pins
  const EYE = `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`;
  const showMarks = (on) => {
    document.body.classList.toggle("marks-hidden", !on);
    showButton.classList.toggle("on", !on);
    showButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${EYE}${on ? "" : `<path d="M3 3l18 18"/>`}</svg>`;
    showButton.title = on ? "Hide all marks (doodles, words, notes)" : "Show all marks again";
    try { localStorage.setItem("chalky-marks-hidden", on ? "" : "1"); } catch {}
  };
  let hiddenAtStart = false;
  try { hiddenAtStart = !!localStorage.getItem("chalky-marks-hidden"); } catch {}
  showMarks(!hiddenAtStart);
  showButton.onclick = () => showMarks(document.body.classList.contains("marks-hidden"));
  page.slot("status").append(button, textButton, eraseButton, showButton);
  const strip = Object.assign(document.createElement("div"), { className: "doodle-strip" });
  form.insertBefore(strip, input);
  const peek = Object.assign(document.createElement("div"), { className: "doodle-peek", hidden: true });
  const big = Object.assign(document.createElement("div"), { className: "doodle-big", hidden: true });  // a step's picture, big
  big.onclick = () => { big.hidden = true; };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") big.hidden = true; });
  document.body.append(peek, big);

  let drawing = false, texting = false, erasing = false, on = false;  // which tools are on; on: any of them
  const docs = new Set([document]);  // this page and every App frame's page: they all get the cursor
  const classes = (el) => {
    el.classList.toggle("doodling", drawing);
    el.classList.toggle("doodle-text", texting);
    el.classList.toggle("doodle-erase", erasing);
  };
  const set = (tool, v) => {  // tool: "doodle" | "text" | "erase"
    if (tool === "doodle") drawing = v; else if (tool === "text") texting = v; else erasing = v;
    on = drawing || texting || erasing;
    button.classList.toggle("on", drawing);
    textButton.classList.toggle("on", texting);
    eraseButton.classList.toggle("on", erasing);
    classes(area);
    for (const d of docs) if (d !== document && d.documentElement) classes(d.documentElement);
    if (v) {
      if (document.body.classList.contains("marks-hidden")) showMarks(true);  // drawing on a hidden layer would be confusing
      if (tool !== "erase") share();
      document.dispatchEvent(new CustomEvent("tool-on", { detail: tool }));
    }
  };
  const allOff = () => { for (const t of ["doodle", "text", "erase"]) set(t, false); };
  button.onclick = () => set("doodle", !drawing);
  textButton.onclick = () => set("text", !texting);
  eraseButton.onclick = () => set("erase", !erasing);
  document.addEventListener("tool-on", (e) => {  // one tool at a time, except the marker and Text, which work together
    const t = e.detail, pair = t === "doodle" || t === "text";
    if (drawing && t !== "doodle" && !pair) set("doodle", false);
    if (texting && t !== "text" && !pair) set("text", false);
    if (erasing && t !== "erase") set("erase", false);
  });

  // ---- pictures: the tab, shared once by the screen extension (none without it: steps go as words) ----
  let screen = null;
  page.use("screen").then((s) => { screen = s; });
  const share = () => screen?.share();
  const frame = () => screen?.frame() ?? null;  // the screen right now, as a canvas (null without a shared tab)
  const picture = (full, box) => screen.picture(full, box);  // crop a frame to box (window px) and upload it: {path, url}

  // ---- where things are ----
  const inMain = (x, y) => {  // window px -> main-space px (as note/browser.js)
    const m = area.getBoundingClientRect();
    return { x: x - m.left + area.scrollLeft, y: y - m.top + area.scrollTop };
  };
  const inWindow = (p) => {
    const m = area.getBoundingClientRect();
    return { x: p.x + m.left - area.scrollLeft, y: p.y + m.top - area.scrollTop };
  };
  const short = (s, n = 40) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  // ---- marks: lines and words ----
  const ink = document.createElementNS(SVG, "svg");  // in the main space only while it has marks (#top:empty shows the welcome)
  ink.classList.add("doodle-ink");
  let marks = [];  // [{el, points (main px), text (words only)}], oldest first
  const show = () => { if (marks.some((m) => m.el.localName === "path" || m.el.localName === "g")) area.append(ink); else ink.remove(); render(); if (!marks.length) hideAsk(); };
  const f = (n) => n.toFixed(1);
  const smooth = (pts) => {  // through the midpoints, so a quick line isn't a row of corners
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) d += ` Q${f(pts[i].x)} ${f(pts[i].y)} ${f((pts[i].x + pts[i + 1].x) / 2)} ${f((pts[i].y + pts[i + 1].y) / 2)}`;
    return d + ` L${f(pts.at(-1).x)} ${f(pts.at(-1).y)}`;
  };
  function note(p, first) {  // words in handwriting at p (main px)
    const n = Object.assign(document.createElement("div"), { className: "doodle-note", contentEditable: "true", textContent: first });
    Object.assign(n.style, { left: `${p.x}px`, top: `${p.y - 14}px` });
    area.append(n);
    n.focus();
    getSelection().selectAllChildren(n);
    getSelection().collapseToEnd();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      n.contentEditable = "false";
      const t = n.textContent.trim();
      if (!t) { n.remove(); return; }
      marks.push({ el: n, points: [p, { x: p.x + n.offsetWidth, y: p.y + n.offsetHeight - 14 }], text: t });
      show();
      later();
    };
    n.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); n.blur(); }
      if (e.key === "Escape") { n.textContent = ""; n.blur(); }
    };
    n.onblur = finish;
  }

  // ---- erasing: a mark goes whole when the eraser passes over it ----
  function eraseAt(p) {  // p: main px
    const left = marks.filter((m) => {
      if (m.text) {  // words: their box
        const x = m.el.offsetLeft, y = m.el.offsetTop;
        return !(p.x >= x - 6 && p.x <= x + m.el.offsetWidth + 6 && p.y >= y - 6 && p.y <= y + m.el.offsetHeight + 6);
      }
      return !m.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 12);  // a line: near any of its points
    });
    if (left.length !== marks.length) {
      for (const m of marks) if (!left.includes(m)) m.el.remove();
      marks = left;
      show();
    }
    for (const [id, m] of Object.entries(saved.marks)) {  // saved marks on this board, not cleared
      const g = saved.groups[m.group];
      if (erased.has(id) || !g || g.state === "cleared" || String(m.board) !== board()) continue;
      const b = drawn[id];
      const pts = b?.pts ?? m.points;  // the user's marks: where they are drawn now (moved with their anchor)
      const hit = pts ? (m.kind === "words" ? inBox(boxOf(pts), p, 6) : pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 12))
        : b && inBox(b, p, 4);
      if (hit) { erased.add(id); page.send({ type: "doodle_erase", id }); }
    }
    document.dispatchEvent(new CustomEvent("erase", { detail: p }));  // other tools' things (frames: unsent frames)
  }

  // ---- steps ----
  let steps = [], first = [];  // steps: [{marks: [text], then: [click], shot: {path, url} | null, ready}]
  let grabbed = null;          // the screen when the last button went down (a click may end a step with it)
  function bounds(pts) {  // window px, with room around the drawing, inside the window
    const w = pts.map(inWindow), pad = 60;
    let x0 = Math.min(...w.map((p) => p.x)) - pad, x1 = Math.max(...w.map((p) => p.x)) + pad;
    let y0 = Math.min(...w.map((p) => p.y)) - pad, y1 = Math.max(...w.map((p) => p.y)) + pad;
    if (x1 - x0 < 480) { const c = (x0 + x1) / 2; x0 = c - 240; x1 = c + 240; }
    if (y1 - y0 < 300) { const c = (y0 + y1) / 2; y0 = c - 150; y1 = c + 150; }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(innerWidth, x1); y1 = Math.min(innerHeight, y1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function keep(full) {  // the marks on the page become a step (full: the screen to crop its picture from)
    const box = marks.length ? bounds(marks.flatMap((m) => m.points)) : { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const at = inMain(box.x, box.y);  // the part of the main space the picture shows, so the agent can place things
    const step = { drawn: marks.length > 0, words: marks.filter((m) => m.text).map((m) => m.text), then: [], shot: null,
                   board: Number(document.body.dataset.board) || 1,  // the board shown (board/)
                   area: { x: Math.round(at.x), y: Math.round(at.y), width: Math.round(box.w), height: Math.round(box.h) } };
    step.ready = full ? picture(full, box).then((s) => { step.shot = s; }, () => {}) : Promise.resolve();
    steps.push(step);
    for (const m of marks) m.el.remove();
    marks = [];
    show();
  }
  // going to another board (board/, just before it changes) is like a click: the drawing so far becomes a step
  document.addEventListener("board", (e) => {
    if (!marks.length && !steps.length && !first.length) return;  // no doodling going on
    if (marks.length) keep(frame());
    (steps.length ? steps.at(-1).then : first).push(`went to board ${e.detail.to}`);
    render();
  });
  function clicked(t, card) {  // a click, as words
    const label = short(t.getAttribute("aria-label") || t.title || t.textContent || t.value || t.localName, 30);
    const row = t.closest("tr, li");
    const rowText = row && row !== t ? short((row.innerText || row.textContent).replace(t.innerText || t.textContent, ""), 30) : "";
    return `clicked "${label}"${rowText ? ` on the "${rowText}" row` : ""}${card ? ` (card ${card})` : ""}`;
  }

  // ---- presses: this page and every App frame's page ----
  // Text boxes draw too (a click still focuses them, a double click still selects a word): circling a notes box
  // is a common thing to draw.
  const OWN_DRAG = ".card-label, .card-resize, select, input[type='range'], [draggable='true'], .frame, .doodle-note";
  const CLICKABLE = "button, a, summary, select, label, [onclick], [role='button'], [role='tab'], [role='checkbox'], input[type='checkbox'], input[type='radio']";
  let press = null, line = null, swallow = false, over = null;  // over: the pointer, in window px, while it is over the page
  function hook(win, frameEl) {
    const doc = win.document;
    if (frameEl) {
      if (docs.has(doc)) return;
      docs.add(doc);
      const s = doc.createElement("style");
      s.textContent = CURSORS;
      doc.head.append(s);
      classes(doc.documentElement);
    }
    const offset = () => {
      if (!frameEl) return { x: 0, y: 0 };
      const r = frameEl.getBoundingClientRect();
      return { x: r.left + frameEl.clientLeft, y: r.top + frameEl.clientTop };
    };
    const root = frameEl ? doc : area;
    root.addEventListener("pointerdown", (e) => {
      if (!on || e.button !== 0 || e.target.closest?.(".doodle-ask")) return;
      hideAsk();
      const o = offset();
      if (erasing) {  // the press is for the eraser, not for what's under it
        e.preventDefault();
        press = { erase: true, win };
        eraseAt(inMain(e.clientX + o.x, e.clientY + o.y));
        return;
      }
      grabbed = marks.length ? frame() : null;  // before the click acts
      if (e.target.closest?.(texting && !drawing ? ".doodle-note" : OWN_DRAG)) return;
      if (texting) e.preventDefault();  // the press is for the words (or a line), not for what's under it
      press = { x: e.clientX + o.x, y: e.clientY + o.y, id: e.pointerId, target: e.target, win, o, text: texting };
    }, true);
    win.addEventListener("pointermove", (e) => {
      const o = offset(), x = e.clientX + o.x, y = e.clientY + o.y;
      over = frameEl || e.target.closest?.("#top") ? { x, y } : null;
      if (press?.erase && press.win === win) { win.getSelection().removeAllRanges(); eraseAt(inMain(x, y)); return; }
      if (!press || press.win !== win || !drawing) return;
      if (!line) {
        if (Math.hypot(x - press.x, y - press.y) < 6) return;  // not yet a line: may still be a click
        line = { el: document.createElementNS(SVG, "g"), points: [inMain(press.x, press.y)] };
        line.el.append(document.createElementNS(SVG, "path"));
        ink.append(line.el);
        marks.push(line);
        show();
        try { press.target.setPointerCapture(press.id); } catch {}
        const active = press.win.document.activeElement;  // a text box the press focused: typing now writes words, not into it
        if (active?.matches?.("input, textarea, [contenteditable='true']")) active.blur();
      }
      win.getSelection().removeAllRanges();  // the first few px may have started a text selection
      const p = inMain(x, y), last = line.points.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      line.points.push(p);
      line.el.firstChild.setAttribute("d", smooth(line.points));
    });
    win.addEventListener("pointerup", () => {
      if (press?.erase) { swallow = true; setTimeout(() => { swallow = false; }); }  // the eraser's press isn't a click
      if (press?.text && !line) {  // Text: words where the press was (a press that drew a line was for the marker)
        note(inMain(press.x, press.y), "");
        swallow = true;
        setTimeout(() => { swallow = false; });
      }
      if (line) {
        if (line.points.length < 3) { marks.pop(); line.el.remove(); }
        swallow = true;  // the click that ends a line isn't a click
        setTimeout(() => { swallow = false; });
        show();
        later();
      }
      press = line = null;
    });
    root.addEventListener("click", (e) => {
      if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; return; }
      const t = on && e.target.closest?.(CLICKABLE);
      if (!t || t.closest(".doodle-note, .doodle-ask")) return;  // the box's ↑ is ours, not a click on the page
      if (marks.length) keep(grabbed);  // the drawing so far, as the screen was when the button went down
      (steps.length ? steps.at(-1).then : first).push(clicked(t, (frameEl || t).closest("[data-card]")?.dataset.card));
      render();
    }, true);
    root.addEventListener("dragstart", (e) => { if (on) e.preventDefault(); }, true);  // links and pictures don't get dragged away
    doc.addEventListener("keydown", onKey);
  }
  hook(window, null);
  const hookFrame = (fr) => {
    const go = () => { try { if (fr.contentDocument?.readyState !== "loading") hook(fr.contentWindow, fr); } catch {} };  // other origins: not ours
    fr.addEventListener("load", go);
    go();
  };
  area.querySelectorAll("iframe").forEach(hookFrame);
  new MutationObserver((list) => {
    for (const r of list) for (const n of r.addedNodes) {
      if (n.localName === "iframe") hookFrame(n);
      else n.querySelectorAll?.("iframe").forEach(hookFrame);
    }
  }).observe(area, { childList: true, subtree: true });

  function onKey(e) {
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (e.key === "Escape" && on) { allOff(); return; }
    if (!on || erasing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      const m = marks.pop();
      if (m) { m.el.remove(); show(); later(); e.preventDefault(); }
      return;
    }
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey && over) {
      e.preventDefault();
      note(inMain(over.x, over.y), e.key);
    }
  }

  // ---- the strip in the message line ----
  function render() {
    strip.replaceChildren();
    steps.forEach((s, i) => {
      const chip = Object.assign(document.createElement("span"), { className: "doodle-chip", textContent: i + 1 });
      const x = Object.assign(document.createElement("span"), { className: "x", textContent: "✕", title: "Drop this step" });
      x.onclick = () => { peek.hidden = true; steps.splice(i, 1); render(); };
      chip.append(x);
      const words = s.words.map((w) => `"${w}"`).join(" ");
      chip.title = s.shot ? "Click to see it big" : "No picture: the tab isn't shared";
      chip.onmouseenter = () => {  // a small preview above the chip
        peek.replaceChildren();
        const place = () => {
          const r = chip.getBoundingClientRect(), p = peek.getBoundingClientRect();
          Object.assign(peek.style, { left: `${Math.max(8, Math.min(innerWidth - p.width - 8, r.left))}px`, top: `${r.top - p.height - 10}px` });
        };
        if (s.shot?.url) peek.append(Object.assign(document.createElement("img"), { src: s.shot.url, onload: place }));
        peek.append(words || (s.shot ? "" : "no picture (the tab isn't shared)"));
        peek.hidden = false;
        place();
      };
      chip.onmouseleave = () => { peek.hidden = true; };
      chip.onclick = (e) => {  // the picture big, over the page; a click or Esc closes it
        if (e.target === x || !s.shot?.url) return;
        peek.hidden = true;
        big.replaceChildren(Object.assign(document.createElement("img"), { src: s.shot.url }),
                            Object.assign(document.createElement("div"), { textContent: `Step ${i + 1}${words ? ` · ${words}` : ""}` }));
        big.hidden = false;
      };
      strip.append(chip);
      for (const c of s.then) strip.append(Object.assign(document.createElement("span"), { className: "doodle-click", textContent: `→ ${c.replace(/^clicked "([^"]*)".*/, "$1")}`, title: c }));
    });
    if (marks.length) strip.append(Object.assign(document.createElement("span"), { className: "doodle-chip now", textContent: `${marks.length} mark${marks.length > 1 ? "s" : ""}` }));
  }

  // ---- send: Enter in the message line takes the doodles along (the page's own send is for plain words) ----
  document.addEventListener("submit", (e) => {
    if (e.target !== form) return;
    if (!steps.length && !marks.length) { if (input.value.trim()) page.send({ type: "doodle_dim" }); return; }  // plain words: answered groups step back
    e.preventDefault();
    e.stopPropagation();
    const text = input.value;
    input.value = "";
    sendAll(text);
  }, true);
  // Ctrl+Enter anywhere sends the doodles (with the box's words, else the message line's)
  document.addEventListener("keydown", (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key === "Enter") || (!steps.length && !marks.length)) return;
    e.preventDefault();
    const text = ask?.querySelector("input").value || input.value;
    input.value = "";
    sendAll(text);
  });
  // Held marks: a copy of what was drawn stays on the page from Enter until the saved group is drawn (the step's picture
  // uploads first), so the drawing doesn't blink out and back
  let held = [];
  function hold() {
    drop();
    if (marks.some((m) => !m.text)) held.push(area.appendChild(ink.cloneNode(true)));
    for (const m of marks) if (m.text) held.push(area.appendChild(m.el.cloneNode(true)));
    const these = held;
    setTimeout(() => { if (held === these) drop(); }, 15000);  // no answer from the server: don't leave them forever
  }
  function drop() { for (const el of held) el.remove(); held = []; }
  async function sendAll(text) {
    hideAsk();
    if (marks.length) hold();
    const r1 = (n) => Math.round(n * 10) / 10;
    const kept = marks.map((m) => ({ kind: m.text ? "words" : "line", points: m.points.map((q) => ({ x: r1(q.x), y: r1(q.y) })), ...(m.text && { text: m.text }) }));
    for (const m of kept) Object.assign(m, say(m));  // before keep() takes them off the page
    if (marks.length) keep(frame());
    else if (steps.at(-1).then.length) keep(frame());  // clicked after the last step: how the screen looks now
    const sent = steps;
    steps = [];
    const before = first;
    first = [];
    render();
    await Promise.all(sent.map((s) => s.ready));
    page.send({ type: "doodle_send", to: document.getElementById("to")?.value, text, first: before, marks: kept, board: board(),
                steps: sent.map((s) => ({ shot: s.shot?.path || null, area: s.area, drawn: s.drawn, words: s.words, then: s.then, board: s.board })) });
    allOff();
  }

  // ---- the box: a moment after the user stops drawing, a box by the last mark asks for words; Enter there sends.
  // Drawing or writing again tucks it away (it comes back after the next pause); Esc closes it, the marks stay. ----
  let ask = null, askTimer = null;
  function later() { clearTimeout(askTimer); if (marks.length) askTimer = setTimeout(showAsk, 1100); }
  function hideAsk() { clearTimeout(askTimer); ask?.remove(); ask = null; }
  function showAsk() {
    if (!marks.length || document.querySelector(".doodle-note[contenteditable='true']")) return;  // still writing words
    hideAsk();
    const last = marks.at(-1).points.at(-1), to = document.getElementById("to")?.value || "agent1";
    ask = Object.assign(document.createElement("form"), { className: "doodle-ask" });
    const m = area.getBoundingClientRect(), room = inMain(m.left + area.clientWidth - 316, m.bottom - 140);  // inside the view (not under the scrollbar)
    Object.assign(ask.style, { left: `${Math.min(last.x + 16, room.x)}px`, top: `${Math.min(last.y + 12, room.y)}px` });
    const field = Object.assign(document.createElement("input"), { placeholder: `Say something… (Enter sends to ${to})`, autocomplete: "off" });
    field.setAttribute("aria-label", "Words to send with your marks");
    const go = Object.assign(document.createElement("button"), { type: "submit", textContent: "↑", title: `Send to ${to} (Enter)` });
    ask.append(field, go);
    ask.onsubmit = (e) => { e.preventDefault(); sendAll(field.value); };
    field.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") hideAsk(); };
    for (const t of ["pointerdown", "click"]) ask.addEventListener(t, (e) => e.stopPropagation());
    area.append(ask);
  }

  // ---- the shared board: saved groups (the user's marks after Enter, the agents' marks), from the server ----
  // A group's marks sit in one container in the main space (data-board: the board extension puts it on its board),
  // in main px, so they scroll with the cards. The agents' marks are drawn from what they are on, found again on
  // every layout, so they follow a card that moves; the box found when drawn is the fallback.
  const board = () => document.body.dataset.board || "1";
  const INK_OF = (by) => by === "user" ? INK : colour(by);
  // the page's colour per agent (page.html), so an agent's ink matches its name in the chat
  const colour = (a) => `hsl(${([...a].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) * 137) % 360} 65% 45%)`;
  let saved = { groups: {}, marks: {} };
  const erased = new Set();  // sent to the server, not yet gone
  const drawn = {};          // mark id -> the box it covers now (main px)
  const containers = {};     // group id -> its element
  const boxOf = (pts) => { const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), x = Math.min(...xs), y = Math.min(...ys);
                           return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  const inBox = (b, q, pad = 0) => q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
  const union = (list) => list.length ? boxOf(list.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])) : null;
  const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const distBox = (b, q) => Math.hypot(Math.max(b.x - q.x, 0, q.x - b.x - b.w), Math.max(b.y - q.y, 0, q.y - b.y - b.h));
  const inPoly = (pts, q) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j];
                               if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  const frameOffset = (fr) => { const r = fr.getBoundingClientRect(); return { x: r.left + fr.clientLeft, y: r.top + fr.clientTop }; };
  function rectOf(el, fr) {  // an element (or a Range), in main px; fr: the app frame it is in
    const r = el.getBoundingClientRect(), o = fr ? frameOffset(fr) : { x: 0, y: 0 }, p = inMain(r.left + o.x, r.top + o.y);
    return { x: p.x, y: p.y, w: r.width, h: r.height };
  }
  const scopes = (el) => [{ root: el, fr: null }, ...[...(el.localName === "iframe" ? [el] : el.querySelectorAll("iframe"))].flatMap((fr) => {
    try { return fr.contentDocument?.body ? [{ root: fr.contentDocument.body, fr }] : []; } catch { return []; }  // other origins: not ours
  })];
  const offBoard = (el) => !!el.closest(".board:not(.on)");

  // What a mark can be on: cards, blocks, and short texts or named things (also in app frames), in main px
  function things() {
    const out = [];
    // how: the thing as find() takes it, so a mark on it can find it again (and move with it)
    for (const c of area.querySelectorAll("[data-card]")) if (!offBoard(c)) out.push({ name: `card ${c.dataset.card}`, box: rectOf(c), el: c, how: { card: c.dataset.card } });
    for (const b of area.querySelectorAll("[data-block]")) if (!offBoard(b)) {
      const card = b.closest("[data-card]")?.dataset.card;
      out.push({ name: `block ${b.dataset.block}` + (card ? ` (card ${card})` : ""), box: rectOf(b), el: b, how: { card, block: b.dataset.block } });
    }
    for (const { root, fr } of scopes(area)) {
      if (fr && offBoard(fr)) continue;
      const frameCard = fr?.closest("[data-card]")?.dataset.card;
      let n = 0;
      for (const el of root.querySelectorAll("*")) {
        if (++n > 4000) break;
        if (el.closest(".doodle-group, .doodle-note, .card-label, .card-resize, .card-back, .note-pin, script, style") || (!fr && offBoard(el))) continue;
        const named = el.dataset?.name || el.id;
        const text = (el.children.length ? "" : el.innerText || el.value || el.alt || "").trim().replace(/\s+/g, " ");
        if (!named && !(text && text.length <= 40) && !["img", "canvas", "input", "button"].includes(el.localName)) continue;
        const card = frameCard ?? el.closest("[data-card]")?.dataset.card;
        const box = rectOf(el, fr);
        if (box.w < 2 || box.h < 2) continue;
        const what = text ? `"${short(text, 40)}"` : el.dataset?.name ? `[data-name="${el.dataset.name}"]` : el.id ? `#${el.id}` : el.localName;
        const tr = el.closest("tr"), row = tr && tr !== el && short(tr.innerText, 60);  // a cell's text alone ("$0", "Food") doesn't say which row
        // the row's longest cell names it best ("Drinks, Golden Gai"): it stays when a quantity or price in it changes
        const key = tr && [...tr.children].map((c) => c.innerText.trim()).filter(Boolean).sort((x, y) => y.length - x.length)[0];
        const label = el.getAttribute?.("aria-label");  // a field's label ("Year 8") names it better than its words ("1994")
        const how = named ? { card, element: named } : label ? { card, element: `[aria-label="${CSS.escape(label)}"]` }
          : text ? { card, text, ...(key && { row: key }) } : { card };
        out.push({ name: what + (row && row !== text ? ` (row: ${row})` : card ? ` (card ${card})` : ""), box, el, leaf: true, how });  // "in <block> (card)" says the card
      }
    }
    return out;
  }
  // A mark in words the page can stand behind: geometry only (the picture shows the rest). Returns {said, anchor}:
  // anchor is the thing the mark is most about (what it rings, underlines, starts from, is written on) and where it
  // is now, so the mark can move with it when the page reflows (a row moved up, a card dragged).
  function say(m) {
    const t = describe(m), how = t.on?.how && { ...t.on.how };
    if (how?.text) {  // the same words in several places ("1994" twice): remember which one
      const all = find(how, true), b = t.on.box;
      const i = Array.isArray(all) ? all.findIndex((x) => inBox(b, centre(x.box), 2)) : -1;
      if (all.length > 1 && i >= 0) how.nth = i;
    }
    const at = how && (find(how).box ?? t.on.box);  // where it is now, measured as it will be found again
    return { said: t.said, ...(how?.card && { anchor: { ...how, at: { x: Math.round(at.x), y: Math.round(at.y) } } }) };
  }
  function describe(m) {
    const T = things(), leaves = T.filter((t) => t.leaf), b = boxOf(m.points), size = (t) => t.box.w * t.box.h;
    const names = (list) => [...new Set(list.sort((x, y) => size(x) - size(y)).map((t) => t.name))].slice(0, 5).join(", ");
    const at = `, box x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} h=${Math.round(b.h)}`;
    const near = (q, pad = 24) => {  // the closest short thing, else the smallest block or card it is in
      const t = leaves.map((t) => [distBox(t.box, q), t]).sort((x, y) => x[0] - y[0])[0];
      if (t && t[0] < pad) return t[1];
      return T.filter((t) => !t.leaf && inBox(t.box, q)).sort((x, y) => size(x) - size(y))[0] ?? null;
    };
    if (m.text) {  // what it is written on, or next to (from where the words start)
      const start = { x: b.x, y: centre(b).y }, on = near(start, 50);
      return { said: `handwriting "${m.text}" ${on ? (inBox(on.box, start) ? "on" : "beside") + " " + on.name : "on empty space"}${at}`, on };
    }
    const p = m.points, a = p[0], z = p.at(-1);
    const inside = T.filter((t) => !t.leaf && inBox(t.box, { x: b.x, y: b.y }) && inBox(t.box, { x: b.x + b.w, y: b.y + b.h })).sort((x, y) => size(x) - size(y))[0];
    const where = inside ? ` in ${inside.name}` : "";
    if (Math.hypot(a.x - z.x, a.y - z.y) < Math.max(34, Math.max(b.w, b.h) * .15) && b.w > 24 && b.h > 12) {  // closed (ends near, for its size): what it goes round
      let enc = leaves.filter((t) => inPoly(p, centre(t.box)));
      if (!enc.length) enc = T.filter((t) => !t.leaf && inPoly(p, centre(t.box)));
      return { said: `closed loop around ${enc.length ? names(enc) : "empty space"}${where}${at}`, on: enc.sort((x, y) => size(x) - size(y))[0] ?? inside };
    }
    if (b.h < 18 && b.w > 30) {  // flat: under or through short things
      const over = leaves.filter((t) => b.x < t.box.x + t.box.w && b.x + b.w > t.box.x);
      const under = over.filter((t) => b.y >= t.box.y + t.box.h - 5 && b.y <= t.box.y + t.box.h + 14);
      const through = over.filter((t) => centre(b).y > t.box.y + t.box.h * .25 && centre(b).y < t.box.y + t.box.h * .75);
      if (under.length) return { said: `line under ${names(under)}${where}${at}`, on: under[0] };
      if (through.length) return { said: `line through ${names(through)}${where}${at}`, on: through[0] };
    }
    const from = near(a), to = near(z);
    const over = leaves.filter((t) => t !== from && t !== to && p.filter((q) => inBox(t.box, q)).length >= 3);
    return { said: `open line from ${from ? from.name : "empty space"} to ${to ? to.name : "empty space"}`
      + (over.length ? `, passing over ${names(over)}` : "") + where + at, on: from ?? to ?? inside };
  }

  // A thing an agent names ({card, block, element, text, mark, note}) -> {box (main px), board} or {error}.
  // An anchor of the user's mark may add row (the table row's longest cell) or nth (which of the same words).
  // every: with text, all the places that have it, in page order (for nth)
  function find(t, every = false) {
    if (t.mark) {
      const m = saved.marks[t.mark];
      if (!m) return { error: `no mark '${t.mark}'` };
      const b = drawn[t.mark] || (m.points && boxOf(m.points));
      return b ? { box: b, board: m.board } : { error: `mark ${t.mark} is not drawn on the page` };
    }
    if (t.note) {
      const pin = document.querySelector(`.note-pin[data-note="${CSS.escape(t.note)}"]`);
      return pin ? { box: rectOf(pin), board: Number(pin.dataset.board) || 1 } : { error: `no note '${t.note}' on the page` };
    }
    let el = area, what = "the page";
    if (t.card) {
      el = area.querySelector(`[data-card="${CSS.escape(t.card)}"]`);
      if (!el) return { error: `no card '${t.card}' on the page` };
      what = `card ${t.card}`;
    }
    if (t.block) {
      const b = el.querySelector(`[data-block="${CSS.escape(t.block)}"]`);
      if (!b) return { error: `no block '${t.block}' in ${what}` };
      el = b;
      what = `block ${t.block}`;
    }
    let found = { el, fr: null };
    const tries = (sel) => [sel, `#${CSS.escape(sel)}`, `[data-name="${CSS.escape(sel)}"]`];
    if (t.element) {
      found = null;
      for (const sc of scopes(el)) for (const sel of tries(t.element)) {
        if (found) break;
        try { const hit = sc.root.querySelector(sel); if (hit) found = { el: hit, fr: sc.fr }; } catch {}  // not a valid selector
      }
      if (!found) return { error: `no element '${t.element}' in ${what}` };
      what = `element ${t.element}`;
    }
    if (t.row) {  // the table row whose text has this (an anchor of the user's mark: "Drinks, Golden Gai")
      let hit = null;
      for (const sc of scopes(found.el)) for (const tr of sc.root.querySelectorAll("tr"))
        if (tr.textContent.includes(t.row) && (!t.text || tr.textContent.includes(t.text)) && (!hit || (offBoard(hit.fr || hit.el) && !offBoard(sc.fr || tr)))) hit = { el: tr, fr: sc.fr };
      if (!hit) return { error: `no row with "${t.row}" in ${what}` };
      found = hit;
      what = `the row "${t.row}"`;
    }
    const brd = Number((found.fr || found.el).closest?.("[data-board]")?.dataset.board) || Number(board());
    if (t.text) {  // the words themselves: every place that has them, just those characters
      const want = t.text.trim().toLowerCase().replace(/\s+/g, " "), all = [];
      for (const sc of found.el === area ? scopes(area) : found.el.localName === "iframe" ? scopes(found.el).slice(1) : [{ root: found.el, fr: found.fr }, ...scopes(found.el).slice(1)]) {
        const walk = sc.root.ownerDocument.createTreeWalker(sc.root, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) {
          if (n.parentElement?.closest(".doodle-group, .doodle-note, .card-label, .card-back, .note-pin, script, style")) continue;
          const i = n.data.toLowerCase().replace(/\s/g, " ").indexOf(want);
          if (i < 0) continue;
          const range = sc.root.ownerDocument.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + want.length);
          const box = rectOf(range, sc.fr);
          if (box.w > 0 && box.h > 0) all.push({ box, len: n.data.length, off: offBoard(sc.fr || n.parentElement) });
        }
        // words in a field (an app's editable title, a form): not text in the page, but what the user sees
        for (const f of sc.root.querySelectorAll("input, textarea, select")) {
          const v = (f.localName === "select" ? f.selectedOptions[0]?.text ?? "" : f.value ?? "").toLowerCase().replace(/\s+/g, " ");
          const box = v.includes(want) && rectOf(f, sc.fr);
          if (box && box.w > 0 && box.h > 0) all.push({ box, len: v.length, off: offBoard(sc.fr || f) });
        }
      }
      if (every) return all;
      // which one: the nth (an anchor that knows the same words show more than once), else the board shown, the shortest text
      const best = t.nth != null && all[t.nth] ? all[t.nth]
        : all.reduce((b, m) => (!b || m.off < b.off || (m.off === b.off && m.len < b.len) ? m : b), null);
      return best ? { box: best.box, board: brd } : { error: `no text "${t.text}" in ${what}` };
    }
    if (found.el === area) return { error: "name a card, block, element, text or mark" };
    const box = found.el.localName === "body" ? rectOf(found.fr) : rectOf(found.el, found.fr);
    return box.w || box.h ? { box, board: brd } : { error: `${what} is not visible` };
  }
  page.on("doodle_check", ({ req, target }) => page.send({ type: "doodle_checked", req, ...find(target) }));
  page.provide("marks", { find, inMain, colour });

  // An agent's gesture on a box -> path data (main px), drawn by hand: a little wobble, the ring doesn't quite close
  const wob = (i, k = 0) => Math.sin(i * 2.3 + k) * 1.2 + Math.cos(i * 1.7 + k) * .8;
  const pt = (x, y) => ({ x, y });
  const edge = (b, toward) => { const c = centre(b), dx = toward.x - c.x, dy = toward.y - c.y, l = Math.hypot(dx, dy) || 1;
                                const k = Math.min(Math.abs(b.w / 2 / (dx || 1e-9)), Math.abs(b.h / 2 / (dy || 1e-9)));
                                return pt(c.x + dx * k + dx / l * 6, c.y + dy * k + dy / l * 6); };
  function gesture(g, b, t) {
    const c = centre(b), n = (k, fn) => smooth(Array.from({ length: k }, (_, i) => fn(i)));
    if (g === "ring") { const rx = b.w / 2 + 10, ry = b.h / 2 + 7;
      return [n(40, (i) => { const a = (-100 + i * 9.4) * Math.PI / 180; return pt(c.x + rx * Math.cos(a) * (1 + i / 420) + wob(i), c.y + ry * Math.sin(a) + wob(i, 3)); })]; }
    if (g === "underline") return [n(12, (i) => pt(b.x - 2 + (b.w + 4) * i / 11, b.y + b.h + 4 + wob(i) * .8))];
    if (g === "strike") return [n(10, (i) => pt(b.x - 4 + (b.w + 8) * i / 9, c.y + wob(i) * .7))];
    if (g === "tick") { const x = b.x + b.w + 8, y = c.y; return [`M${x} ${y} L${x + 5} ${y + 7} L${x + 16} ${y - 10}`]; }
    if (g === "cross") return [`M${b.x - 3} ${b.y - 3} L${b.x + b.w + 3} ${b.y + b.h + 3}`, `M${b.x + b.w + 3} ${b.y - 3} L${b.x - 3} ${b.y + b.h + 3}`];
    if (g === "arrow" && t) { const s = edge(b, centre(t)), e = edge(t, centre(b)), m = pt((s.x + e.x) / 2, (s.y + e.y) / 2 - 18), a = Math.atan2(e.y - m.y, e.x - m.x);
      return [`M${f(s.x)} ${f(s.y)} Q${f(m.x)} ${f(m.y)} ${f(e.x)} ${f(e.y)}`,
              `M${f(e.x - 12 * Math.cos(a - .5))} ${f(e.y - 12 * Math.sin(a - .5))} L${f(e.x)} ${f(e.y)} L${f(e.x - 12 * Math.cos(a + .5))} ${f(e.y - 12 * Math.sin(a + .5))}`]; }
    return [];
  }
  // Where an agent's words go: the first spot near the thing that covers nothing (no text on the page, no other
  // words): right of it, past its card's edge on the same line, below, above; then down the card's margin past
  // other words; else right of it anyway
  function placeWords(text, b, el, on) {
    const w = el.offsetWidth || text.length * 9 + 10, h = el.offsetHeight || 24, room = area.scrollWidth - 8;
    const cardEl = on?.card && area.querySelector(`[data-card="${CSS.escape(on.card)}"]`), card = cardEl && rectOf(cardEl);
    const busy = [...things().filter((t) => t.leaf && !(inBox(b, centre(t.box), 2))).map((t) => t.box),
                  ...Object.values(words).filter((x) => x.el !== el && x.el.isConnected).map((x) => x.box)];
    const free = (p) => p.x >= 4 && p.x + w <= room && p.y >= 0 && !busy.some((t) => !(p.x + w <= t.x || p.x >= t.x + t.w || p.y + h <= t.y || p.y >= t.y + t.h));
    const mid = b.y + b.h / 2 - h / 2;
    const spots = [{ x: b.x + b.w + 14, y: mid }, ...(card ? [{ x: card.x + card.w + 14, y: mid }] : []),
                   { x: b.x, y: b.y + b.h + 6 }, { x: b.x, y: b.y - h - 4 },
                   ...(card ? Array.from({ length: 8 }, (_, i) => ({ x: card.x + card.w + 14, y: mid + (i % 2 ? -1 : 1) * Math.ceil((i + 1) / 2) * h })) : [])];
    for (const p of spots) if (free(p)) return { ...p, w, h };
    const p = spots[0];
    return { x: Math.min(p.x, room - w), y: p.y, w, h };
  }
  const words = {};  // agent mark id -> {el, box}: its handwriting, so others step past it

  function container(id, g, ghost = false) {
    const key = ghost ? `${id}-ghost` : id;
    let el = containers[key];
    if (!el) {
      el = containers[key] = Object.assign(document.createElement("div"), { className: "doodle-group" });
      el.dataset.group = id;
      el.append(document.createElementNS(SVG, "svg"));
      area.append(el);
    }
    el.dataset.board = g.board ?? 1;
    el.classList.toggle("dim", !!g.dim && !ghost);
    el.classList.toggle("ghost", ghost);
    return el;
  }
  function pathIn(el, d, ink, animate) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.style.setProperty("--ink", ink);
    el.firstChild.append(p);
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = L;
      p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset .7s ease-out";
      requestAnimationFrame(() => { p.style.strokeDashoffset = 0; });
    }
    return p;
  }
  function moved(m) {  // how far a user's mark's anchor has moved since it was drawn (0 if it can't be found)
    const f = m.anchor && find(m.anchor);
    if (!f?.box) return { x: 0, y: 0, key: m.anchor ? "not found" : "fixed" };
    const x = Math.round(f.box.x - m.anchor.at.x), y = Math.round(f.box.y - m.anchor.at.y);
    return { x, y, key: `${x},${y}` };
  }
  // Draw one mark into its group's container (again, if it is there: its old parts go first)
  function drawMark(id, m, el, animate = false) {
    for (const old of el.querySelectorAll(`[data-mark="${id}"]`)) old.remove();
    const ink = INK_OF(m.by), tag = (n) => { n.dataset.mark = id; return n; };
    if (m.kind === "line" || m.kind === "words") {  // the user's: where drawn, moved as far as its anchor moved since
      const d = moved(m), pts = m.points.map((q) => ({ x: q.x + d.x, y: q.y + d.y }));
      if (m.kind === "line") tag(pathIn(el, smooth(pts), ink, false));
      else {
        const w = tag(Object.assign(document.createElement("div"), { className: "words", textContent: m.text }));
        Object.assign(w.style, { left: `${pts[0].x}px`, top: `${pts[0].y - 14}px` });
        w.style.setProperty("--ink", ink);
        el.append(w);
      }
      drawn[id] = Object.assign(boxOf(pts), { pts, at: d.key });
      return;
    }
    const at = find(m.on), b = at.box || m.box;  // an agent's gesture: on the thing as it is now
    if (!b) return;
    const t = m.to ? find(m.to).box || m.toBox : null;
    const parts = gesture(m.gesture, b, t).map((d) => tag(pathIn(el, d, ink, animate)));
    const boxes = parts.map((p) => { const r = p.getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    if (m.words) {
      const w = tag(Object.assign(document.createElement("div"), { className: "words agent", textContent: m.words }));
      w.style.setProperty("--ink", ink);
      el.append(w);
      const near = m.gesture === "arrow" && t ? { x: (centre(b).x + centre(t).x) / 2 - 10, y: (centre(b).y + centre(t).y) / 2 - 34, w: 20, h: 20 } : b;
      const pos = placeWords(m.words, near, w, m.on);
      Object.assign(w.style, { left: `${pos.x}px`, top: `${pos.y}px` });
      words[id] = { el: w, box: pos };
      boxes.push(pos);
      if (animate) { w.style.opacity = 0; w.style.transition = "opacity .5s .5s"; requestAnimationFrame(() => { w.style.opacity = 1; }); }
    }
    drawn[id] = union(boxes) || b;
    drawn[id].at = !at.box ? "saved box" :  // not found yet (the cards draw after this): the next look draws it again
      `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}` + (t ? `>${Math.round(t.x)},${Math.round(t.y)}` : "");
  }
  // The ✓ chip: by the user's marks in the group (else by the agent's); clears the group for everyone
  function chip(id, el) {
    el.querySelector(":scope > .chip")?.remove();
    const mine = Object.entries(saved.marks).filter(([, m]) => m.group === id);
    const yours = mine.filter(([, m]) => m.by === "user");
    const b = union((yours.length ? yours : mine).map(([mid]) => drawn[mid]).filter(Boolean));
    if (!b) return;
    const c = Object.assign(document.createElement("button"), { className: "chip", textContent: "✓", type: "button",
      title: "Done: clear these marks (yours and the agent's). You can bring them back from the chat log." });
    // by the user's marks: the box's corner (a ring leaves it empty); only the agent's: just outside, clear of its ticks
    Object.assign(c.style, yours.length ? { left: `${b.x + b.w - 18}px`, top: `${Math.max(0, b.y - 4)}px` }
                                        : { left: `${b.x + b.w + 8}px`, top: `${Math.max(0, b.y - 22)}px` });
    c.onclick = (e) => { e.stopPropagation(); page.send({ type: "doodle_clear", group: id }); };
    el.append(c);
  }
  function drawGroup(id, ghost = false, animate = null) {
    const g = saved.groups[id];
    if (!g) return;
    const el = container(id, g, ghost);
    for (const [mid, m] of Object.entries(saved.marks)) if (m.group === id) drawMark(mid, m, el, animate === mid);
    if (!ghost) chip(id, el);
  }
  function dropGroup(key, fade = false) {
    const el = containers[key];
    if (!el) return;
    delete containers[key];
    if (!fade) return el.remove();
    el.classList.add("gone");
    setTimeout(() => el.remove(), 800);
  }
  const labelOf = (id) => {  // "your ring around "12.50"" style words for the chat log
    const g = saved.groups[id];
    return g ? (g.by === "user" ? `your marks (${g.label})` : `${g.by}'s marks`) : "a group of marks";
  };
  // Cleared groups come back from the chat: hover shows a ghost of them, a click brings them back
  function backFrom(el, id) {
    if (el.dataset.back) return;
    el.dataset.back = id;
    el.addEventListener("mouseenter", () => {
      const cleared = saved.groups[id]?.state === "cleared";
      el.classList.toggle("doodle-back", cleared);
      el.title = cleared ? "These marks were cleared: click to bring them back" : "";
      if (cleared) drawGroup(id, true);
    });
    el.addEventListener("mouseleave", () => dropGroup(`${id}-ghost`));
    el.addEventListener("click", (e) => {
      if (saved.groups[id]?.state !== "cleared") return;
      e.stopPropagation();
      dropGroup(`${id}-ghost`);
      page.send({ type: "doodle_restore", group: id });
    });
  }
  const log = document.getElementById("log");
  const scanLog = (root) => { for (const el of root.querySelectorAll?.("[data-raw]") ?? []) {
    const m = /\ngroup: (g\d+)/.exec(el.dataset.raw);
    if (m) backFrom(el, m[1]);
  } };
  if (log) new MutationObserver((list) => { for (const r of list) for (const n of r.addedNodes) if (n.nodeType === 1) scanLog(n.parentElement || n); })
    .observe(log, { childList: true, subtree: true });

  page.on("doodle_group", ({ group, marks: added, ...g }) => {
    if (added) drop();  // a new group of the user's: drawn below, so the held copy goes
    const before = saved.groups[group];
    saved.groups[group] = g;
    Object.assign(saved.marks, added || {});
    if (g.state === "cleared") {
      dropGroup(group, true);
      if (before && before.state !== "cleared") {
        const who = g.clearedBy === "user" ? "You" : g.clearedBy;
        const line = page.note(`${who} cleared ${labelOf(group)}: hover to see them, click to bring them back`);
        if (line) backFrom(line, group);
      }
    } else drawGroup(group);
  });
  page.on("doodle_mark", ({ id, ...m }) => {
    saved.marks[id] = m;
    const g = saved.groups[m.group];
    if (g && g.state !== "cleared") drawGroup(m.group, false, id);
  });
  page.on("doodle_gone", ({ group }) => {  // its board was removed
    for (const [id, m] of Object.entries(saved.marks)) if (m.group === group) { delete saved.marks[id]; delete drawn[id]; delete words[id]; }
    delete saved.groups[group];
    dropGroup(group);
  });
  page.on("doodle_erased", ({ id, group }) => {
    delete saved.marks[id];
    delete drawn[id];
    delete words[id];
    erased.delete(id);
    for (const n of containers[group]?.querySelectorAll(`[data-mark="${id}"]`) ?? []) n.remove();
    if (!Object.values(saved.marks).some((m) => m.group === group)) { delete saved.groups[group]; dropGroup(group); }
    else if (containers[group]) chip(group, containers[group]);
  });
  // Agents' marks follow what they are on (a card moved, a row changed): look again now and then
  setInterval(() => {
    for (const [id, m] of Object.entries(saved.marks)) {
      const g = saved.groups[m.group];
      if (!g || g.state === "cleared" || String(m.board) !== board() || !containers[m.group]) continue;
      if (m.kind !== "gesture") {  // the user's: follow its anchor
        if (m.anchor && moved(m).key !== drawn[id]?.at) { drawMark(id, m, containers[m.group]); chip(m.group, containers[m.group]); }
        continue;
      }
      const b = find(m.on).box, t = m.to ? find(m.to).box : null;
      if (!b) continue;
      const at = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}` + (t ? `>${Math.round(t.x)},${Math.round(t.y)}` : "");
      if (drawn[id]?.at !== at) { drawMark(id, m, containers[m.group]); chip(m.group, containers[m.group]); }
    }
  }, 1500);
  try {
    saved = await (await fetch("/doodle/all")).json();
    for (const [id, g] of Object.entries(saved.groups)) if (g.state !== "cleared") drawGroup(id);
    scanLog(log);
  } catch {}
}
