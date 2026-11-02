// The page side of the doodle extension: three tools in the palette, a marker, Text and an eraser. The marker and
// Text can be on together; the eraser (like any other tool) turns them off.
//   marker  drag draws on the page, over cards and inside app frames (same-origin). A press that doesn't move
//           is an ordinary click, so double and triple clicks still select text. Typing with the pointer over the
//           page and no text box focused puts words in handwriting there.
//   Text    (T) every click puts words in handwriting there; Enter or a click elsewhere ends them. With the
//           marker on too, a drag draws and a click writes.
//   eraser  press or drag over a line or words to take them away whole; it also says "erase" (a page event,
//           {x, y} in main-space px) so other tools take theirs away (frames: an unsent frame).
//   click   with the marker (Text off) works the page as usual. If there is drawing, it first becomes a step: a picture of the screen
//           as it was when the button went down (before the click acts), cropped to the drawing, and the
//           ink clears. The drawing goes only as the picture; typed words also go as text, exactly. Clicks
//           are written down as words, between the steps.
//   Enter   in the message line (also with the marker off) sends the steps, the drawing still on the page and
//           the words typed there, together: doodle_send, to the agent picked in the chat.
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
    .doodle-big img { max-width: 92vw; max-height: 84vh; border-radius: 10px; box-shadow: 0 20px 60px rgba(0, 0, 0, .4); background: #fff; }`;
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
  page.slot("status").append(button, textButton, eraseButton);
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
  const show = () => { if (marks.some((m) => m.el.localName === "path" || m.el.localName === "g")) area.append(ink); else ink.remove(); render(); };
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
      if (!on || e.button !== 0) return;
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
      }
      press = line = null;
    });
    root.addEventListener("click", (e) => {
      if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; return; }
      const t = on && e.target.closest?.(CLICKABLE);
      if (!t || t.closest(".doodle-note")) return;
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
      if (m) { m.el.remove(); show(); e.preventDefault(); }
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
  document.addEventListener("submit", async (e) => {
    if (e.target !== form || (!steps.length && !marks.length)) return;
    e.preventDefault();
    e.stopPropagation();
    const text = input.value;
    input.value = "";
    if (marks.length) keep(frame());
    else if (steps.at(-1).then.length) keep(frame());  // clicked after the last step: how the screen looks now
    const sent = steps;
    steps = [];
    const before = first;
    first = [];
    render();
    await Promise.all(sent.map((s) => s.ready));
    page.send({ type: "doodle_send", to: document.getElementById("to")?.value, text, first: before,
                steps: sent.map((s) => ({ shot: s.shot?.path || null, area: s.area, drawn: s.drawn, words: s.words, then: s.then, board: s.board })) });
    allOff();
  }, true);
}
