// Browser half of the frames extension (Python's frames.js, unchanged but for this header): a frame tool in the palette (a dashed box). While it is on, drag on the
// main space to lay down a frame: a dashed box with a field for what goes there (Enter finishes it). While the
// tool is on, an Implement button (a hammer with the number of frames in a bubble, in the row under the tool)
// sends every unsent frame that has words, together (frames_send, to the agent picked in the chat); while it is
// off, the bubble sits on the tool itself, so waiting frames still show. Until then, a frame's corner resizes it, like a surface's (frame_place).
// Sent frames stay as they are, marked waiting, until an agent renders a surface with their id (index.ts
// then drops them); ✕ on a frame, or the eraser passing over an unsent one ("erase" event), removes it.
// Esc or the tool turns drawing off.
// Frames live in the main space (slot "top"), in main-space px, so they scroll with the surfaces.
export default async function (page) {
  const area = page.slot("top");
  const style = document.createElement("style");
  style.textContent = `
    #top.framing { cursor: crosshair; z-index: 11; }  /* above the messages panel (10), so frames can be drawn there too */
    #top .frame { position: absolute; z-index: 100000; box-sizing: border-box; display: grid; place-items: center; padding: 12px;
                  border: 1.5px dashed var(--muted); border-radius: 12px; background: var(--glass); cursor: default;
                  backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }
    #top .frame.drawing { pointer-events: none; }
    #top .frame textarea { width: 100%; max-width: 360px; border: 0; outline: 0; resize: none; background: none; font: inherit;
                           font-size: 14px; color: var(--text); text-align: center; field-sizing: content; max-height: 100%; }
    #top .frame textarea::placeholder { color: var(--muted); }
    #top .frame.sent { border-color: var(--accent); }
    #top .frame.sent textarea { color: var(--soft); }
    #top .frame .frame-id { position: absolute; left: 10px; top: 6px; font-size: 11px; color: var(--muted); }
    #top .frame.sent .frame-id::after { content: " · waiting for an agent"; }
    #top .frame .frame-x { position: absolute; right: 6px; top: 4px; width: 22px; height: 22px; border-radius: 6px;
                           color: var(--muted); opacity: 0; }
    #top .frame:hover .frame-x { opacity: 1; }
    #top .frame .frame-x:hover { background: var(--hover); color: var(--text); }
    #top .frame .frame-resize { position: absolute; right: 0; bottom: 0; width: 10px; height: 10px; box-sizing: border-box;
                                border: solid var(--muted); border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; cursor: nwse-resize; opacity: 0; }
    #top .frame:hover .frame-resize { opacity: 1; }
    #top .frame.sent .frame-resize { display: none; }
    #status button.frames-send { color: var(--accent); }`;
  document.head.append(style);

  const button = document.createElement("button");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke-dasharray="3 2.5"/></svg>`;
  button.title = "Frames: drag boxes on the page and write what goes in each, then Implement them together (Esc to stop)";
  button.append(Object.assign(document.createElement("span"), { className: "badge" }));  // frames waiting, while the tool is off
  const send = document.createElement("button");
  send.className = "frames-send";
  send.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 12-8.4 8.4a2.1 2.1 0 0 1-3-3L12 9"/><path d="m18 15 4-4"/>` +
    `<path d="m21.5 11.5-1.9-1.9a2 2 0 0 1-.6-1.4V7l-2.3-2.3a6 6 0 0 0-4.2-1.7H9l.9.8A6.2 6.2 0 0 1 12 8.4V10l2 2h1.2a2 2 0 0 1 1.4.6l1.9 1.9"/></svg>` +
    `<span class="badge"></span>`;  // the hammer: build these
  send.hidden = true;
  page.tool(button).append(send);

  let on = false, ready = 0;  // ready: unsent frames with words
  const showReady = () => {  // only one row under the palette shows at a time: the tool that is on
    send.hidden = !(on && ready);
    send.querySelector(".badge").textContent = ready || "";
    button.querySelector(".badge").textContent = !on && ready ? ready : "";
  };
  const setOn = (v) => {
    on = v;
    button.classList.toggle("on", v);
    area.classList.toggle("framing", v);
    showReady();
    if (v) document.dispatchEvent(new CustomEvent("tool-on", { detail: "frames" }));  // the other tools turn off
  };
  button.onclick = () => setOn(!on);
  document.addEventListener("tool-on", (e) => { if (on && e.detail !== "frames") setOn(false); });  // one tool at a time
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOn(false); });
  send.onclick = () => {
    for (const flush of Object.values(timers)) { clearTimeout(flush.t); flush(); }  // text still waiting on the typing pause goes first
    page.send({ type: "frames_send", to: document.getElementById("to")?.value, board: board() });
  };
  const board = () => Number(document.body.dataset.board) || 1;  // the board shown (boards/): frames are drawn and sent there
  document.addEventListener("board", () => setTimeout(() => render(shown)));  // after the switch: count that board's

  const inMain = (x, y) => {  // window px -> main-space px (as point.js)
    const m = area.getBoundingClientRect();
    return { x: Math.round(x - m.left + area.scrollLeft), y: Math.round(y - m.top + area.scrollTop) };
  };
  const put = (box, f) => Object.assign(box.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.width}px`, height: `${f.height}px` });

  // Drawing: on the main space, over empty space or surfaces, but not on a frame (that is for typing).
  let start = null, ghost = null, focusNew = false;
  area.addEventListener("mousedown", (e) => {
    if (!on || e.button !== 0 || e.target.closest(".frame")) return;
    e.preventDefault();
    e.stopPropagation();
    start = inMain(e.clientX, e.clientY);
    ghost = Object.assign(document.createElement("div"), { className: "frame drawing" });
    area.append(ghost);
  }, true);
  area.addEventListener("click", (e) => { if (on && !e.target.closest(".frame")) e.stopPropagation(); }, true);  // surfaces don't react
  window.addEventListener("mousemove", (e) => {
    if (!start) return;
    const p = inMain(e.clientX, e.clientY);
    put(ghost, { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
  });
  window.addEventListener("mouseup", () => {
    if (!start) return;
    const f = { x: parseInt(ghost.style.left), y: parseInt(ghost.style.top), width: parseInt(ghost.style.width), height: parseInt(ghost.style.height) };
    ghost.remove();
    start = ghost = null;
    if (f.width >= 40 && f.height >= 30) { focusNew = true; page.send({ type: "frame_add", ...f, board: board() }); }  // a click or a slip is not a frame
  });

  const boxes = {};  // id -> its box on the page
  const timers = {};
  let shown = {};  // the frames as last rendered
  document.addEventListener("erase", (e) => {  // the doodle eraser at {x, y}, main px: unsent frames under it go
    const p = e.detail;
    for (const [id, f] of Object.entries(shown)) {
      if (f.sent || (f.board ?? 1) !== board() || p.x < f.x || p.x > f.x + f.width || p.y < f.y || p.y > f.y + f.height) continue;
      delete shown[id];  // once, though the eraser keeps moving over it
      page.send({ type: "frame_remove", id });
    }
  });
  function render(frames) {
    shown = { ...frames };
    for (const id of Object.keys(boxes)) if (!frames[id]) { boxes[id].remove(); delete boxes[id]; }
    let newest = null;
    for (const [id, f] of Object.entries(frames)) {
      let box = boxes[id];
      if (!box) {
        box = boxes[id] = Object.assign(document.createElement("div"), { className: "frame" });
        box.dataset.frame = id;
        const label = Object.assign(document.createElement("span"), { className: "frame-id", textContent: id });
        const close = Object.assign(document.createElement("button"), { className: "frame-x", textContent: "✕", title: "Remove this frame" });
        close.onclick = () => page.send({ type: "frame_remove", id });
        const text = Object.assign(document.createElement("textarea"), { rows: 1, placeholder: "What goes here?" });
        text.oninput = () => {
          clearTimeout(timers[id]?.t);
          const flush = timers[id] = () => { delete timers[id]; page.send({ type: "frame_text", id, text: text.value }); };
          flush.t = setTimeout(flush, 300);
        };
        text.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); text.blur(); } };
        const corner = Object.assign(document.createElement("div"), { className: "frame-resize", title: "Drag to resize" });
        corner.onpointerdown = (e) => resize(box, id, e);
        box.append(label, close, text, corner);
        area.append(box);
        newest = box;
      }
      put(box, f);
      box.dataset.board = f.board ?? 1;  // boards/ shows it on its board
      box.classList.toggle("sent", f.sent);
      const text = box.querySelector("textarea");
      text.readOnly = f.sent;
      if (document.activeElement !== text) text.value = f.text;
    }
    if (focusNew && newest) { focusNew = false; newest.querySelector("textarea").focus(); }
    ready = Object.values(frames).filter((f) => !f.sent && f.text.trim() && (f.board ?? 1) === board()).length;
    showReady();
    send.title = `Implement: send ${ready} frame${ready > 1 ? "s" : ""} to the agent to build, together`;
  }
  function resize(box, id, e) {  // drag the corner (as ui.js does for surfaces); on release the new size is saved
    e.preventDefault();
    const corner = e.currentTarget, x = box.offsetLeft, y = box.offsetTop, w0 = box.offsetWidth, h0 = box.offsetHeight;
    corner.setPointerCapture(e.pointerId);
    let place = null;
    corner.onpointermove = (ev) => {
      place = { x, y, width: Math.max(40, Math.round(w0 + ev.clientX - e.clientX)), height: Math.max(30, Math.round(h0 + ev.clientY - e.clientY)) };
      put(box, place);
    };
    corner.onpointerup = () => {
      corner.onpointermove = corner.onpointerup = null;
      if (place) page.send({ type: "frame_place", id, ...place });
    };
  }
  page.on("frames", (ev) => render(ev.frames));
  try { render(await (await fetch("/frames")).json()); } catch {}
}
