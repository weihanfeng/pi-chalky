// The page side of the board extension: the main space as numbered boards, and the shelf to move between them (above the input).
// Each board is a container in #top. The one you're on is display: contents (its things sit in the main space as
// before); the others are laid out but hidden, so apps in them keep running and the shelf can draw them.
// Any element with data-board="n" that lands in #top (a card, a frame) is moved into board n's container, and
// moved again when its data-board changes (a MutationObserver): no extension needs this one. One on the body (a
// note's pin, fixed to the window) shows only while its board is shown.
// Other scripts read the board shown from body[data-board] (new things go there), and get a DOM event "board"
// {from, to} just before it changes (doodle: the drawing so far becomes a step; frames: count this board's).
// The shelf: a dot per board (yours is bigger). Hover it and the dots open into thumbnails, with + for a new board;
// click one to go there. It stays clear of the chat panel: more thumbnails than fit scroll between ‹ and › (grey at
// the ends; a new board scrolls to the end). Drag a card by its label onto a thumbnail to move it to that board, where it was ({type: "card_board"}).
// Zoom: each board keeps its own (in this browser), as CSS zoom on #top, so places stay in main-space px; the control
// at the bottom right (−, %, +, fit), or Ctrl/⌘ + wheel (a trackpad pinch). See setZoom below.
//   page messages  board_view {board}: the board this page shows; board_add
//   GET /board     {boards, current}        event "board" {boards, added?, by?}
const CSS = `
  #top > .board:not(.on) { position: absolute; top: 0; left: 0; right: 0; height: 0; overflow: hidden; padding: inherit;
    box-sizing: border-box; visibility: hidden; pointer-events: none; }
  #top > .board.on { display: contents; }
  #top > .board.on:empty::before { content: "What should we build?"; position: absolute; inset: 0; display: grid; place-items: center;
    font-size: 30px; font-weight: 300; letter-spacing: -0.02em; color: rgba(0, 0, 0, 0.2); pointer-events: none; }
  .boards-shelf { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 25; display: flex; align-items: flex-end;
    gap: 8px; padding: 5px 8px; border-radius: 14px; border: 1px solid transparent; transition: background 0.15s; }
  .boards-shelf.open { background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border-color: var(--edge); box-shadow: var(--shadow); }
  .boards-shelf .slot { position: relative; display: grid; justify-items: center; gap: 4px; padding: 0; }
  .boards-shelf .slot .x { display: none; position: absolute; top: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%;
    font-size: 9px; line-height: 16px; text-align: center; color: var(--danger); background: var(--glass-strong); box-shadow: var(--shadow); }
  .boards-shelf.open .slot:hover .x { display: block; }
  .boards-shelf .dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(0, 0, 0, 0.22); transition: all 0.15s; }
  .boards-shelf .slot.on .dot { width: 11px; height: 11px; background: var(--text); }
  /* more boards than fit (fit(): clear of the chat panel): the thumbnails scroll inside .view, between ‹ and › */
  .boards-shelf .view { overflow: hidden; scroll-behavior: smooth; padding: 3px; }
  .boards-shelf .track { position: relative; display: flex; align-items: flex-end; gap: 8px; width: max-content; }
  .boards-shelf .arrow { display: none; width: 24px; height: 70px; margin-top: 3px; align-self: flex-start; border-radius: 6px;
    font-size: 20px; color: var(--text); }
  .boards-shelf.open.more .arrow { display: block; }
  .boards-shelf .arrow:disabled { opacity: 0.25; cursor: default; }
  .boards-shelf .arrow:not(:disabled):hover { background: var(--hover); }
  .boards-shelf .mini { display: none; position: relative; width: 120px; overflow: hidden; border-radius: 6px;
    background: rgba(255, 255, 255, 0.6); border: 1px solid var(--line); }
  .boards-shelf .mini i, .boards-peek .mini i { position: absolute; overflow: hidden; border-radius: 3px; background: rgba(0, 0, 0, 0.08); }
  /* a card: a tile in its own main colour (light grey when it has none) */
  .boards-shelf .mini i.s, .boards-peek .mini i.s { --accent-of: rgb(200, 203, 210);
    background: color-mix(in srgb, var(--accent-of) 30%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-of) 70%, transparent), 0 1px 3px rgba(0, 0, 0, 0.08); }
  .boards-shelf .mini i.s::before, .boards-peek .mini i.s::before { content: ""; position: absolute; left: 0; right: 0; top: 0;
    height: max(2px, 12%); background: var(--accent-of); }
  .boards-peek .mini i.s.detail { background: #fff; }  /* the sketch of its insides shows its colours */
  .boards-peek .mini i.s.detail::before { display: none; }
  .boards-peek .mini i u, .boards-peek .mini i img { display: block; }
  .boards-peek { position: fixed; z-index: 26; transform: translateX(-50%); padding: 6px; border-radius: 12px; pointer-events: none;
    background: var(--glass-strong); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border: 1px solid var(--edge); box-shadow: var(--shadow); }
  .boards-peek .n { font-size: 11px; color: var(--muted); margin: 0 2px 4px; }
  .boards-peek .mini { position: relative; width: 320px; overflow: hidden; border-radius: 8px; background: rgba(255, 255, 255, 0.6);
    border: 1px solid var(--line); }
  .boards-peek .empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--muted); }
  .boards-shelf .n { display: none; font-size: 10.5px; color: var(--muted); }
  .boards-shelf.open .mini, .boards-shelf.open .n { display: block; }
  .boards-shelf.open .dot { display: none; }
  .boards-shelf .slot.on .mini { outline: 2px solid var(--text); outline-offset: 1px; }
  .boards-shelf .slot.drop .mini { outline: 2px solid var(--accent); outline-offset: 1px; }
  .boards-shelf .add { display: none; width: 122px; height: 70px; border-radius: 6px;  /* a thumbnail's size, border included */ border: 1px dashed rgba(0, 0, 0, 0.25);
    color: var(--muted); font-size: 13px; align-self: flex-start; margin-top: 3px; }
  .boards-shelf.open .add { display: block; }  /* only in the open shelf: at rest it's just the dots */
  /* zoom: CSS zoom on #top scales everything in the main space; its padding (room for the palette, rail, input) stays
     the same on screen */
  #top { padding: calc(var(--palette) / var(--zoom, 1)) calc((var(--rail) + 28px) / var(--zoom, 1))
                  calc(var(--bar) / var(--zoom, 1)) calc((var(--rail) + 28px) / var(--zoom, 1)); }
  .boards-zoom { position: fixed; right: 16px; bottom: 24px; z-index: 25; display: flex; align-items: center; gap: 2px; padding: 3px;
    border-radius: 12px; background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border: 1px solid var(--edge); box-shadow: var(--shadow); font-size: 12px; color: var(--soft); }
  .boards-zoom button { height: 26px; min-width: 26px; padding: 0 6px; border-radius: 8px; font-variant-numeric: tabular-nums; }
  .boards-zoom button:hover { background: var(--hover); color: var(--text); }
  .boards-zoom .pct { min-width: 46px; }
  .boards-zoom .fit { font-size: 15px; }
  /* the hand: drag the board to move around it; what is on it doesn't react meanwhile (apps' frames included) */
  #top.panning { cursor: grab; }
  #top.panning.grabbing { cursor: grabbing; }
  #top.panning * { pointer-events: none !important; }`;

export default async function (page) {
  document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
  const top = page.slot("top");
  const containers = {};
  let boards = [1], current = 1, drag = null, over = null, adding = false;  // adding: this page clicked +

  const container = (n) => {
    if (!containers[n]) {
      containers[n] = Object.assign(document.createElement("div"), { className: "board" });
      containers[n].dataset.n = n;
      top.append(containers[n]);
    }
    return containers[n];
  };
  const home = (el) => {  // an element with data-board: into its board's container
    const c = container(Number(el.dataset.board) || 1);
    if (el.parentElement !== c) c.append(el);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") home(r.target);
      else for (const el of r.addedNodes) if (el.parentElement === top && el.dataset?.board) home(el);
    }
  }).observe(top, { childList: true, subtree: true, attributeFilter: ["data-board"] });

  // the shelf: ‹ [the thumbnails, scrolling] › +   (+ outside the scrolling part, so it is always there)
  const shelf = Object.assign(document.createElement("div"), { className: "boards-shelf" });
  shelf.dataset.name = "boards";
  const button = (className, textContent, title, onclick) => Object.assign(document.createElement("button"), { className, textContent, title, onclick });
  const view = Object.assign(document.createElement("div"), { className: "view" });
  const track = Object.assign(document.createElement("div"), { className: "track" });
  const step = (d) => view.scrollBy({ left: d * Math.max(130, view.clientWidth - 130) });  // about a view's width
  const prev = button("arrow", "‹", "Earlier boards", () => step(-1));
  const next = button("arrow", "›", "Later boards", () => step(1));
  const add = button("add", "+", "New board", () => { adding = true; page.send({ type: "board_add" }); });
  add.dataset.name = "new-board";
  view.append(track);
  shelf.append(prev, view, next, add);
  document.body.append(shelf);
  shelf.onmouseenter = () => open(true);
  shelf.onmouseleave = () => { if (!drag) open(false); };
  view.onscroll = arrows;
  // the wheel's left/right (or up/down): each click moves the strip as an arrow does; the page doesn't scroll. At
  // most one step per 250 ms, as a trackpad swipe sends many small wheel events
  let lastWheel = 0;
  shelf.addEventListener("wheel", (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!shelf.classList.contains("more") || !d) return;
    e.preventDefault();
    if (Date.now() - lastWheel < 250) return;
    lastWheel = Date.now();
    step(Math.sign(d));
  }, { passive: false });
  addEventListener("resize", fit);
  new MutationObserver(fit).observe(document.body, { attributeFilter: ["data-panel"] });  // the chat panel opened or closed

  function fit() {  // as wide as fits between the chat panel (or the rail) and the same gap on the right, centred
    const side = ["messages", "versions"].includes(document.body.dataset.panel) ? "panel" : "rail";
    const left = document.getElementById(side)?.getBoundingClientRect().right ?? 0;
    view.style.maxWidth = `${Math.max(130, innerWidth - 2 * (left + 16) - 2 * 32 - 140)}px`;  // the arrows and + beside it
    shelf.classList.toggle("more", track.scrollWidth > view.clientWidth + 1);
    arrows();
  }
  function arrows() {  // grey at the ends
    prev.disabled = view.scrollLeft <= 0;
    next.disabled = view.scrollLeft + view.clientWidth >= view.scrollWidth - 1;
  }
  function reveal() {  // the board shown, in view (a new one: the strip goes to the end)
    const s = track.querySelector(".slot.on");
    if (s && (s.offsetLeft < view.scrollLeft || s.offsetLeft + s.offsetWidth > view.scrollLeft + view.clientWidth))
      view.scrollLeft = s.offsetLeft - (view.clientWidth - s.offsetWidth) / 2;
  }

  // ---- zoom: each board's own, kept in this browser (localStorage) ----
  // CSS zoom on #top: places stay in main-space px (what cards, frames and marks store), and #top's scrollLeft/Top and
  // clientWidth are in them too. Window px -> main px is (x - left) / zoom + scroll: the other extensions divide by
  // #top's style.zoom where they turn the pointer into main px. Ctrl/⌘ + wheel (a trackpad pinch) zooms at the
  // pointer; the control at the bottom right: −, the percentage (click: back to 100%), +, and fit (the whole board).
  const MIN = 0.25, MAX = 2, KEY = "chalky.board-zoom";
  const shot = new URLSearchParams(location.search).has("shot");  // the versions' headless view: always 100%
  let zooms = {};
  try { zooms = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const zoomOf = () => parseFloat(top.style.zoom) || 1;
  function setZoom(z, at, save = true) {  // at: the window point that stays put (else the middle of the view)
    z = shot ? 1 : Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
    const m = top.getBoundingClientRect(), z0 = zoomOf();
    at ??= { x: m.left + m.width / 2, y: m.top + m.height / 2 };
    const p = { x: (at.x - m.left) / z0 + top.scrollLeft, y: (at.y - m.top) / z0 + top.scrollTop };  // in main px
    top.style.zoom = z === 1 ? "" : z;
    top.style.setProperty("--zoom", z);
    if (z !== z0) { top.scrollLeft = p.x - (at.x - m.left) / z; top.scrollTop = p.y - (at.y - m.top) / z; }
    pct.textContent = `${Math.round(z * 100)}%`;
    if (save) {
      if (z === 1) delete zooms[current]; else zooms[current] = z;
      try { localStorage.setItem(KEY, JSON.stringify(zooms)); } catch {}
    }
  }
  function fitZoom() {  // everything on this board in view
    const els = [...container(current).children], z0 = zoomOf(), m = top.getBoundingClientRect();
    if (!els.length) return setZoom(1);
    const rs = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
    const main = (x, y) => ({ x: (x - m.left) / z0 + top.scrollLeft, y: (y - m.top) / z0 + top.scrollTop });
    const a = main(Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)));
    const b = main(Math.max(...rs.map((r) => r.right)), Math.max(...rs.map((r) => r.bottom)));
    const s = getComputedStyle(document.documentElement), px = (v) => parseFloat(s.getPropertyValue(v)) || 0;
    const side = px("--rail") + 28, w = innerWidth - 2 * side, h = innerHeight - px("--palette") - px("--bar");  // inside the padding
    const z = Math.min(MAX, Math.max(MIN, Math.min(w / (b.x - a.x + 24), h / (b.y - a.y + 24), 1)));
    setZoom(z);
    top.scrollLeft = (a.x + b.x) / 2 - (m.width / 2) / z;
    top.scrollTop = a.y - 12 - px("--palette") / z;
  }
  const zoomBar = Object.assign(document.createElement("div"), { className: "boards-zoom" });
  zoomBar.dataset.name = "zoom";
  const pct = button("pct", "100%", "Back to 100%", () => setZoom(1));
  zoomBar.append(button("", "−", "Zoom out", () => setZoom(zoomOf() / 1.25)), pct,
                 button("", "+", "Zoom in", () => setZoom(zoomOf() * 1.25)), button("fit", "⤢", "Fit the whole board", fitZoom));
  document.body.append(zoomBar);
  const pinch = (e, at) => {  // ctrl + wheel (a pinch on a trackpad sends that): zoom at the pointer, not the browser's
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoomOf() * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), at);
  };
  // anywhere on the page, not only over the main space: over the messages panel (which lies over the board) a pinch
  // would otherwise scroll the messages; captured, so nothing under the pointer scrolls with it
  addEventListener("wheel", (e) => pinch(e, { x: e.clientX, y: e.clientY }), { passive: false, capture: true });
  top.addEventListener("load", (e) => {  // an app's frame (same site): its pinches too, its px turned into window px
    const fr = e.target;
    if (fr.localName !== "iframe") return;
    try {
      fr.contentWindow.addEventListener("wheel", (ev) => {
        const r = fr.getBoundingClientRect(), k = zoomOf();
        pinch(ev, { x: r.left + fr.clientLeft * k + ev.clientX * k, y: r.top + fr.clientTop * k + ev.clientY * k });
      }, { passive: false });
    } catch {}  // another site's frame
  }, true);

  // ---- the hand: drag to move around the board (scrolls #top). The palette's hand tool (one tool at a time, Esc
  // stops it); or hold Space (when not typing and no other tool is on); or drag with the middle button, any time.
  // Two-finger scrolling on a trackpad moves around too (the browser's own scrolling).
  const HAND = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/>` +
    `<path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0V12"/><path d="M14 5.5a1.5 1.5 0 0 1 3 0V12"/>` +
    `<path d="M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2 .2a6 6 0 0 1-5-2.7l-.2-.3c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2 1.9 1.9 0 0 1 2.3.3L8 13"/></svg>`;
  const handButton = Object.assign(document.createElement("button"), { innerHTML: HAND,
    title: "Hand: drag to move around the board (or hold Space, or drag with the middle button; Esc to stop)" });
  handButton.dataset.name = "hand";
  handButton.style.order = 99;  // the palette's last tool, at the right end, whichever script adds its tools after this one
  page.slot("status").append(handButton);
  let hand = false, spaceHand = false, panning = null;  // panning: {x, y, left, top} at the press
  const panMode = () => top.classList.toggle("panning", hand || spaceHand || !!panning);
  function setHand(v) {
    hand = v;
    handButton.classList.toggle("on", v);
    panMode();
    if (v) document.dispatchEvent(new CustomEvent("tool-on", { detail: "hand" }));  // the other tools turn off
  }
  handButton.onclick = () => setHand(!hand);
  document.addEventListener("tool-on", (e) => { if (hand && e.detail !== "hand") setHand(false); });
  const typing = () => document.activeElement?.matches?.("input, textarea, select, [contenteditable=''], [contenteditable='true']") ||
    document.activeElement?.localName === "iframe";  // an app has the keys
  const otherTool = () => !!document.querySelector("#status button.on:not([data-name='show-marks']):not([data-name='hand'])");
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setHand(false);
    if (e.code !== "Space") return;
    if (spaceHand) return e.preventDefault();  // held: its repeats don't scroll the page either
    if (typing() || otherTool() || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();  // not a page scroll, nor a click on the focused button
    spaceHand = true;
    panMode();
  }, true);
  addEventListener("keyup", (e) => { if (e.code === "Space" && spaceHand) { spaceHand = false; panMode(); } }, true);
  addEventListener("blur", () => { spaceHand = false; panMode(); });
  top.addEventListener("pointerdown", (e) => {
    if (!(e.button === 1 || (e.button === 0 && (hand || spaceHand)))) return;
    e.preventDefault();
    e.stopImmediatePropagation();  // not a click, a line or a frame on what is under it
    panning = { x: e.clientX, y: e.clientY, left: top.scrollLeft, top: top.scrollTop, id: e.pointerId };
    top.setPointerCapture(e.pointerId);
    top.classList.add("grabbing");
    panMode();
  }, true);
  top.addEventListener("pointermove", (e) => {
    if (!panning || e.pointerId !== panning.id) return;
    const z = zoomOf();  // window px moved -> main px scrolled, so the board stays under the pointer
    top.scrollLeft = panning.left - (e.clientX - panning.x) / z;
    top.scrollTop = panning.top - (e.clientY - panning.y) / z;
  });
  const stopPan = (e) => {
    if (!panning || e.pointerId !== panning.id) return;
    panning = null;
    top.classList.remove("grabbing");
    panMode();
  };
  top.addEventListener("pointerup", stopPan);
  top.addEventListener("pointercancel", stopPan);
  top.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });  // the middle button doesn't open links

  const others = document.createElement("style");  // hides what is on the body for other boards (a note's pin)
  document.head.append(others);
  function show(n, tell = true) {  // go to board n (tell: the server, which the first show got it from)
    // before the switch, so a doodle in progress becomes a step with a picture of this board
    if (n !== current) document.dispatchEvent(new CustomEvent("board", { detail: { from: current, to: n } }));
    current = n;
    document.body.dataset.board = n;
    others.textContent = `body > [data-board]:not([data-board="${n}"]) { display: none !important; }`;
    for (const b of boards) container(b).classList.toggle("on", b === n);
    setZoom(zooms[n] ?? 1, null, false);  // each board keeps its own zoom (in this browser)
    if (tell) page.send({ type: "board_view", board: n });
    render();
  }

  function render() {
    const shown = boards.filter((n) => n !== pending?.n);
    track.replaceChildren(...shown.map((n) => {
      const slot = document.createElement("button");
      slot.className = "slot" + (n === current ? " on" : "");
      slot.dataset.n = n;
      slot.title = `Board ${n}`;
      slot.innerHTML = `<span class="mini"></span><span class="dot"></span><span class="n">${n}</span>` +
        (shown.length > 1 ? `<span class="x" role="button" title="Remove board ${n} and everything on it">✕</span>` : "");  // the last board stays
      slot.onclick = (e) => (e.target.closest(".x") ? removeBoard(n) : show(n));
      slot.onmouseenter = () => showPeek(slot);
      slot.onmouseleave = () => { peek.hidden = true; };  // off it (onto +, a gap): no preview
      return slot;
    }));
    if (shelf.classList.contains("open")) { thumbnails(); fit(); reveal(); }
    else fit();
  }

  // ✕ on a thumbnail: the board leaves the shelf with a few seconds of Undo, and only then goes from the server
  // (board_remove: its things go with it). Leaving the page in those seconds removes it at once.
  let pending = null;  // {n, was: the board shown when ✕ was clicked, timer}
  let toast = null;  // the notice with Undo (pageApi.notice)
  function removeBoard(n) {
    if (pending) commit();
    const i = boards.indexOf(n);
    pending = { n, was: current, timer: setTimeout(commit, 5000) };
    peek.hidden = true;
    if (current === n) show(boards.filter((b) => b !== n)[Math.max(0, i - 1)]);  // the one before it (else after)
    else render();
    toast?.close();
    toast = page.notice([`Board ${n} removed`, button("go", "Undo", "Bring it back", undo)], () => pending && commit());  // ✕: removed now
  }
  function commit() {
    clearTimeout(pending.timer);
    page.send({ type: "board_remove", board: pending.n });
    pending = null;
    toast?.close();
  }
  function undo() {
    clearTimeout(pending.timer);
    const { n, was } = pending;
    pending = null;
    toast?.close();
    if (was === n) show(n);
    else render();
  }
  addEventListener("pagehide", () => { if (pending) commit(); });

  function thumbnails() {
    for (const slot of shelf.querySelectorAll(".slot")) drawBoard(slot.querySelector(".mini"), Number(slot.dataset.n), 120, 68);
  }
  // board n's things where they are in the main space, scaled down into mini (w x h): a card is a small tile in
  // its main colour (accentOf), no words. Zoomed to fit what's on the board (not the whole window), so the tiles fill it.
  function drawBoard(mini, n, W, H) {
    const PAD = 12, els = [...container(n).children];
    const rects = els.map((el) => el.getBoundingClientRect());
    const x0 = Math.min(...rects.map((r) => r.left)) - PAD, y0 = Math.min(...rects.map((r) => r.top)) - PAD;
    const k = Math.min(W / (Math.max(...rects.map((r) => r.right)) + PAD - x0), H / (Math.max(...rects.map((r) => r.bottom)) + PAD - y0), 0.5);
    mini.style.height = `${H}px`;
    mini.replaceChildren(...els.map((el, n) => {
      const r = rects[n], i = document.createElement("i");
      if (el.dataset.card) {
        const accent = accentOf(el.querySelector(".card-body") ?? el);
        i.className = "s";
        i.title = el.dataset.card;
        if (accent) i.style.setProperty("--accent-of", accent);
        if (W > 200) { i.classList.add("detail"); sketch(el, i, k); }  // the big preview: what's inside it
      }
      Object.assign(i.style, { left: `${(r.left - x0) * k}px`, top: `${(r.top - y0) * k}px`,
                               width: `${Math.max(2, r.width * k)}px`, height: `${Math.max(2, r.height * k)}px` });
      return i;
    }));
  }
  // hover one thumbnail: a bigger picture of that board above the shelf, to read it
  const peek = Object.assign(document.createElement("div"), { className: "boards-peek", hidden: true });
  document.body.append(peek);
  function showPeek(slot) {
    if (!slot || drag) return (peek.hidden = true);
    const n = Number(slot.dataset.n), mini = Object.assign(document.createElement("div"), { className: "mini" });
    peek.replaceChildren(Object.assign(document.createElement("div"), { className: "n", textContent: `Board ${n}` }), mini);
    peek.hidden = false;
    drawBoard(mini, n, 320, 180);
    if (!mini.children.length) mini.append(Object.assign(document.createElement("span"), { className: "empty", textContent: "Empty" }));
    const s = slot.getBoundingClientRect(), half = peek.offsetWidth / 2;
    peek.style.left = `${Math.min(innerWidth - half - 8, Math.max(half + 8, s.left + s.width / 2))}px`;
    peek.style.bottom = `${innerHeight - shelf.getBoundingClientRect().top + 8}px`;
  }
  // a card's insides, scaled by k into its tile (the big preview): each line of text a bar in its colour, coloured
  // areas (buttons, filled boxes) in theirs, pictures and canvases (a game) as small images. Apps' pages too (same
  // server). No words. At most 400 pieces a card.
  function sketch(card, tile, k) {
    const base = card.getBoundingClientRect();
    const put = (tag, r, dx, dy, style) => {
      if (r.width * k < 0.5 || r.height * k < 0.5) return null;
      const e = tile.appendChild(document.createElement(tag));
      Object.assign(e.style, { position: "absolute", left: `${(r.left + dx - base.left) * k}px`, top: `${(r.top + dy - base.top) * k}px`,
                               width: `${r.width * k}px`, height: `${r.height * k}px` }, style);
      return e;
    };
    const roots = [[card.querySelector(".card-body") ?? card, 0, 0]];
    for (const f of card.querySelectorAll("iframe")) {
      try { const r = f.getBoundingClientRect(); if (f.contentDocument?.body) roots.push([f.contentDocument.body, r.left + f.clientLeft, r.top + f.clientTop]); } catch {}
    }
    let n = 0;
    for (const [root, dx, dy] of roots) {
      const win = root.ownerDocument.defaultView, walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let node = walk.currentNode; node && n < 400; node = walk.nextNode()) {
        if (node.nodeType === 3) {  // text: a bar per line, in its colour
          if (!node.data.trim() || node.parentElement.closest("style, script")) continue;
          const range = root.ownerDocument.createRange();
          range.selectNodeContents(node);
          const color = win.getComputedStyle(node.parentElement).color;
          for (const r of range.getClientRects())
            if (put("u", { left: r.left, top: r.top + r.height * 0.3, width: r.width, height: r.height * 0.4 }, dx, dy,
                     { background: color, opacity: "0.45", borderRadius: "1px" })) n++;
          continue;
        }
        const cs = win.getComputedStyle(node), r = node.getBoundingClientRect();
        if (node.localName === "img" && node.currentSrc) { const e = put("img", r, dx, dy, { objectFit: cs.objectFit }); if (e) { e.src = node.currentSrc; n++; } }
        else if (node.localName === "canvas") {
          let src = null;
          try { src = node.toDataURL("image/png"); } catch {}  // a canvas painted from another site can't be read
          const e = put(src ? "img" : "u", r, dx, dy, src ? {} : { background: "rgba(0, 0, 0, 0.12)" });
          if (e && src) e.src = src;
          if (e) n++;
        } else if ((cs.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1) > 0.05 && !/^rgba?\(255, 255, 255/.test(cs.backgroundColor) && cs.backgroundColor !== "transparent") {
          if (put("u", r, dx, dy, { background: cs.backgroundColor, borderRadius: `${parseFloat(cs.borderTopLeftRadius) * k}px` })) n++;
        }
      }
    }
  }
  // the colour a thing shows most: each coloured background counts by its area, a border or text a little; whites,
  // greys and blacks don't count. Apps are pages from this server, so their frame's insides count too. None: null
  function accentOf(node) {
    const roots = [node, ...[...node.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument?.body; } catch { return null; } })];
    const score = {};
    const add = (color, weight) => {
      const m = color.match(/[\d.]+/g)?.map(Number);
      if (!m || (m[3] ?? 1) < 0.3) return;
      const [r, g, b] = m, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
      const sat = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * l - 1));
      if (sat < 0.25 || l < 0.12 || l > 0.92) return;  // white, grey, black
      const key = `rgb(${r & 0xf0},${g & 0xf0},${b & 0xf0})`;  // near colours count together
      score[key] = { color: `rgb(${r},${g},${b})`, n: (score[key]?.n ?? 0) + weight };
    };
    for (const root of roots.filter(Boolean)) {
      for (const e of [root, ...root.querySelectorAll("*")].slice(0, 400)) {
        const cs = e.ownerDocument.defaultView.getComputedStyle(e);
        add(cs.backgroundColor, Math.min(e.offsetWidth * e.offsetHeight, 60000));
        if (parseFloat(cs.borderTopWidth) > 0) add(cs.borderTopColor, 400);
        if ([...e.childNodes].some((c) => c.nodeType === 3 && c.data.trim())) add(cs.color, 300);
        if (e.localName === "svg" || e.closest("svg")) add(cs.fill, 600);
      }
    }
    return Object.values(score).sort((a, b) => b.n - a.n)[0]?.color ?? null;
  }
  function open(yes) {
    shelf.classList.toggle("open", yes);
    if (yes) { thumbnails(); fit(); reveal(); }
    else { peek.hidden = true; fit(); }
  }

  // drag a card (by its label: card/browser.js moves it) onto a thumbnail: it goes to that board, at the place it had
  document.addEventListener("pointerdown", (e) => {
    const box = e.target.closest?.("[data-card] > .card-label")?.parentElement;
    if (!box || e.target.closest("button")) return;
    const px = (v) => (v ? parseFloat(v) : undefined);
    drag = { id: box.dataset.card, board: Number(box.dataset.board) || 1,
             place: box.hasAttribute("data-placed") ? { x: box.offsetLeft, y: box.offsetTop, width: px(box.style.width), height: px(box.style.height) } : null };
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = shelf.getBoundingClientRect();
    if (!shelf.classList.contains("open") && e.clientY > r.top - 80 && e.clientX > r.left - 80 && e.clientX < r.right + 80) open(true);
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const now = under.find((el) => el.matches(".boards-shelf .slot")) ?? null;
    if (now !== over) { over?.classList.remove("drop"); over = now; over?.classList.add("drop"); }
    const arrow = under.find((el) => el.matches(".boards-shelf .arrow:not(:disabled)"));  // held over ‹ or ›: the strip moves on
    if (arrow && Date.now() - lastStep > 600) { lastStep = Date.now(); step(arrow === prev ? -1 : 1); }
  });
  let lastStep = 0;
  document.addEventListener("pointerup", () => {
    if (!drag) return;
    const to = over && Number(over.dataset.n);
    if (to && to !== drag.board) page.send({ type: "card_board", card: drag.id, board: to, place: drag.place });
    over?.classList.remove("drop");
    drag = over = null;
    if (!shelf.matches(":hover")) open(false);
  });

  page.on("board", (ev) => {
    boards = ev.boards;
    if (ev.removed) {  // its things went with it (their own events); its container goes now
      containers[ev.removed]?.remove();
      delete containers[ev.removed];
      if (!boards.includes(current)) return show(boards[0]);  // another page removed the board this one shows
    }
    if (ev.added && ev.by === "user" && adding) { adding = false; return show(ev.added); }  // the + clicked here: go there
    render();
  });

  try { ({ boards, current } = await (await fetch("/board")).json()); } catch {}
  show(current, false);  // nothing to tell: the server said it (and the page's WebSocket may not be open yet)
}
