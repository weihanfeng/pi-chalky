// The page side of the history extension: undo, redo and rewind the cards.
//   Ctrl+Z / ⌘Z: undo.  Ctrl+Shift+Z / ⌘⇧Z / Ctrl+Y: redo.  (Not while typing in a field: that undoes the typing.)
//   Hold Alt (Option) and drag sideways anywhere: scrub along the history; let go to stay there.
//   Doing something new after going back starts a branch; a note offers to bring the other one back.
// It only sends messages (history_undo, history_redo, history_goto); the server puts the cards back and the card extension redraws them.
const CSS = `
  #history-bar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 9999; display: flex;
    flex-direction: column; align-items: center; gap: 6px; max-width: calc(100vw - 32px); padding: 8px 14px; border-radius: 12px;
    font-size: 12px; color: #fff; background: rgba(29, 29, 31, .92); pointer-events: none; }
  #history-bar .ticks { display: flex; gap: 2px; flex-wrap: wrap; justify-content: center; }
  #history-bar .ticks i { width: 6px; height: 14px; border-radius: 2px; background: #fff; opacity: .3; }
  #history-bar .ticks i.now { opacity: 1; background: #f4d35e; }
  #history-bar .ticks i.ahead { opacity: .12; }
  #history-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 9999; display: flex; gap: 10px;
    align-items: center; padding: 8px 14px; border-radius: 12px; font-size: 13px; color: #fff; background: rgba(29, 29, 31, .92); }
  #history-toast button { font: inherit; color: inherit; background: none; border: 1px solid currentColor; border-radius: 8px;
    padding: 2px 10px; cursor: pointer; }`;

export default function (page) {
  document.head.insertAdjacentHTML("beforeend", `<style id="history-css">${CSS}</style>`);
  const bar = Object.assign(document.createElement("div"), { id: "history-bar", hidden: true });
  const toastEl = Object.assign(document.createElement("div"), { id: "history-toast", hidden: true });
  document.body.append(bar, toastEl);
  let toastTimer;
  function toast(text, button, onclick) {
    toastEl.replaceChildren(Object.assign(document.createElement("span"), { textContent: text }));
    if (button) toastEl.append(Object.assign(document.createElement("button"), { textContent: button,
      onclick: () => { toastEl.hidden = true; onclick(); } }));
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), button ? 8000 : 2500);
  }

  const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable='true']");
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || typing(e)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); page.send({ type: "history_undo" }); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); page.send({ type: "history_redo" }); }
  });

  // {x0, x, line, start, i} while Alt-dragging. It starts at the press, before the history has come (line: null till
  // then), so a release or moves during the fetch are not lost; it ends at the release, or at the first move without
  // the button held (released outside the window), a cancelled drag, or the window losing focus.
  let scrub = null;
  function showBar() {
    const { line, i } = scrub, from = Math.max(0, line.length - 80);
    const ticks = Object.assign(document.createElement("div"), { className: "ticks" });
    for (let j = from; j < line.length; j++) ticks.append(Object.assign(document.createElement("i"), { className: j === i ? "now" : j > i ? "ahead" : "" }));
    const step = line[i];
    bar.replaceChildren(Object.assign(document.createElement("span"), {
      textContent: `${i + 1} of ${line.length}: ${step.what}, ${new Date(step.ts * 1000).toLocaleTimeString()}` }), ticks);
    bar.hidden = false;
  }
  function follow() {  // go to the step under the pointer
    const step = Math.max(10, Math.min(40, 600 / scrub.line.length));  // px per step: the whole line fits in ~600 px
    const i = Math.max(0, Math.min(scrub.line.length - 1, scrub.start + Math.round((scrub.x - scrub.x0) / step)));
    if (i === scrub.i) return;
    scrub.i = i;
    page.send({ type: "history_goto", step: scrub.line[i].n });
    showBar();
  }
  document.addEventListener("pointerdown", async (e) => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    const me = scrub = { x0: e.clientX, x: e.clientX, line: null };
    let history;
    try { history = await (await fetch("/history")).json(); } catch { if (scrub === me) scrub = null; return; }
    if (scrub !== me) return;  // let go before the history came: nothing to do
    me.line = history.line;
    me.start = me.i = history.line.findIndex((s) => s.n === history.at);
    showBar();
    follow();  // the pointer may have moved meanwhile
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (!scrub) return;
    if (!(e.buttons & 1)) return end();  // the button is up: it was let go outside the window
    scrub.x = e.clientX;
    if (scrub.line) follow();
  });
  document.addEventListener("pointerup", () => end());
  document.addEventListener("pointercancel", () => end());
  addEventListener("blur", () => end());
  function end() {
    if (!scrub) return;
    const ahead = scrub.line && scrub.i < scrub.line.length - 1;
    scrub = null;
    bar.hidden = true;
    if (ahead) toast("Gone back. Do something new to branch from here, or Ctrl+Shift+Z to come forward.");
  }

  page.on("history", (ev) => {
    if (ev.event === "moved" && !scrub) toast(`Back to just after: ${ev.what}`);
    if (ev.event === "branched") toast("You branched from an earlier moment. The other version is kept.", "Bring it back",
      () => page.send({ type: "history_goto", step: ev.tip }));
  });
}
