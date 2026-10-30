// Browser half of boards: the main space as numbered boards, and the shelf to move between them (above the input).
// Each board is a container in #top. The one you're on is display: contents (its things sit in the main space as
// before); the others are laid out but hidden, so apps in them keep running and the shelf can draw them.
// Any element with data-board="n" that lands in #top (a surface, a frame) is moved into board n's container, and
// moved again when its data-board changes (a MutationObserver): no extension needs this one. One on the body (a
// note's pin, fixed to the window) shows only while its board is shown.
// Other scripts read the board shown from body[data-board] (new things go there), and get a DOM event "board"
// {from, to} just before it changes (doodle: the drawing so far becomes a step; frames: count this board's).
// The shelf: a dot per board (yours is bigger). Hover it and the dots open into thumbnails, with + for a new board;
// click one to go there. It stays clear of the chat panel: more thumbnails than fit scroll between ‹ and › (grey at
// the ends; a new board scrolls to the end). Drag a surface by its label onto a thumbnail to move it to that board, where it was ({type: "ui_board"}).
//   page messages  board_view {board}: the board this page shows; board_add
//   GET /boards    {boards, current}        event "boards" {boards, added?, by?}
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
  .boards-toast { position: fixed; left: 50%; top: 76px; transform: translateX(-50%);  /* under the palette: clear of the shelf */ z-index: 27; display: flex; gap: 12px;
    align-items: center; padding: 7px 14px; border-radius: 10px; background: rgba(29, 29, 31, 0.88); color: #fff; font-size: 13px; }
  .boards-toast button { color: #9cc3f5; font-weight: 600; }
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
  /* a surface: a card in its own main colour (light grey when it has none) */
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
  .boards-shelf.open .add { display: block; }  /* only in the open shelf: at rest it's just the dots */`;

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
  const button = (className, textContent, title, onclick) => Object.assign(document.createElement("button"), { className, textContent, title, onclick });
  const view = Object.assign(document.createElement("div"), { className: "view" });
  const track = Object.assign(document.createElement("div"), { className: "track" });
  const step = (d) => view.scrollBy({ left: d * Math.max(130, view.clientWidth - 130) });  // about a view's width
  const prev = button("arrow", "‹", "Earlier boards", () => step(-1));
  const next = button("arrow", "›", "Later boards", () => step(1));
  const add = button("add", "+", "New board", () => { adding = true; page.send({ type: "board_add" }); });
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

  const others = document.createElement("style");  // hides what is on the body for other boards (a note's pin)
  document.head.append(others);
  function show(n, tell = true) {  // go to board n (tell: the server, which the first show got it from)
    // before the switch, so a doodle in progress becomes a step with a picture of this board
    if (n !== current) document.dispatchEvent(new CustomEvent("board", { detail: { from: current, to: n } }));
    current = n;
    document.body.dataset.board = n;
    others.textContent = `body > [data-board]:not([data-board="${n}"]) { display: none !important; }`;
    for (const b of boards) container(b).classList.toggle("on", b === n);
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
  const toast = Object.assign(document.createElement("div"), { className: "boards-toast", hidden: true });
  document.body.append(toast);
  function removeBoard(n) {
    if (pending) commit();
    const i = boards.indexOf(n);
    pending = { n, was: current, timer: setTimeout(commit, 5000) };
    peek.hidden = true;
    if (current === n) show(boards.filter((b) => b !== n)[Math.max(0, i - 1)]);  // the one before it (else after)
    else render();
    toast.replaceChildren(`Board ${n} removed`, button("", "Undo", "Bring it back", undo));
    toast.hidden = false;
  }
  function commit() {
    clearTimeout(pending.timer);
    page.send({ type: "board_remove", board: pending.n });
    pending = null;
    toast.hidden = true;
  }
  function undo() {
    clearTimeout(pending.timer);
    const { n, was } = pending;
    pending = null;
    toast.hidden = true;
    if (was === n) show(n);
    else render();
  }
  addEventListener("pagehide", () => { if (pending) commit(); });

  function thumbnails() {
    for (const slot of shelf.querySelectorAll(".slot")) drawBoard(slot.querySelector(".mini"), Number(slot.dataset.n), 120, 68);
  }
  // board n's things where they are in the main space, scaled down into mini (w x h): a surface is a small card in
  // its main colour (accentOf), no words. Zoomed to fit what's on the board (not the whole window), so the cards fill it.
  function drawBoard(mini, n, W, H) {
    const PAD = 12, els = [...container(n).children];
    const rects = els.map((el) => el.getBoundingClientRect());
    const x0 = Math.min(...rects.map((r) => r.left)) - PAD, y0 = Math.min(...rects.map((r) => r.top)) - PAD;
    const k = Math.min(W / (Math.max(...rects.map((r) => r.right)) + PAD - x0), H / (Math.max(...rects.map((r) => r.bottom)) + PAD - y0), 0.5);
    mini.style.height = `${H}px`;
    mini.replaceChildren(...els.map((el, n) => {
      const r = rects[n], i = document.createElement("i");
      if (el.dataset.surface) {
        const accent = accentOf(el.querySelector(".surface-body") ?? el);
        i.className = "s";
        i.title = el.dataset.surface;
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
  // a surface's insides, scaled by k into its card (the big preview): each line of text a bar in its colour, coloured
  // areas (buttons, filled boxes) in theirs, pictures and canvases (a game) as small images. Apps' pages too (same
  // server). No words. At most 400 pieces a surface.
  function sketch(surface, card, k) {
    const base = surface.getBoundingClientRect();
    const put = (tag, r, dx, dy, style) => {
      if (r.width * k < 0.5 || r.height * k < 0.5) return null;
      const e = card.appendChild(document.createElement(tag));
      Object.assign(e.style, { position: "absolute", left: `${(r.left + dx - base.left) * k}px`, top: `${(r.top + dy - base.top) * k}px`,
                               width: `${r.width * k}px`, height: `${r.height * k}px` }, style);
      return e;
    };
    const roots = [[surface.querySelector(".surface-body") ?? surface, 0, 0]];
    for (const f of surface.querySelectorAll("iframe")) {
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

  // drag a surface (by its label: ui/browser.js moves it) onto a thumbnail: it goes to that board, at the place it had
  document.addEventListener("pointerdown", (e) => {
    const box = e.target.closest?.("[data-surface] > .surface-label")?.parentElement;
    if (!box || e.target.closest("button")) return;
    const px = (v) => (v ? parseFloat(v) : undefined);
    drag = { id: box.dataset.surface, board: Number(box.dataset.board) || 1,
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
    if (to && to !== drag.board) page.send({ type: "ui_board", surface: drag.id, board: to, place: drag.place });
    over?.classList.remove("drop");
    drag = over = null;
    if (!shelf.matches(":hover")) open(false);
  });

  page.on("boards", (ev) => {
    boards = ev.boards;
    if (ev.removed) {  // its things went with it (their own events); its container goes now
      containers[ev.removed]?.remove();
      delete containers[ev.removed];
      if (!boards.includes(current)) return show(boards[0]);  // another page removed the board this one shows
    }
    if (ev.added && ev.by === "user" && adding) { adding = false; return show(ev.added); }  // the + clicked here: go there
    render();
  });

  try { ({ boards, current } = await (await fetch("/boards")).json()); } catch {}
  show(current, false);  // nothing to tell: the server said it (and the page's WebSocket may not be open yet)
}
