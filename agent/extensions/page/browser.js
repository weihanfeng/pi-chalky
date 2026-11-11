// The page side of page_run (page/index.ts): runs an agent's code in this page, or inside a card's app, where the user
// can watch it, and answers.
//   page message page_tab {tab}   this tab is the one the user looks at: when this script loads, and on focus
//   event "page_run" {req, tab, card, code, agent}   only the tab named runs it -> page message page_ran {req, value?, error?, errors}
//   page message page_stop {agent}   the bar's Stop: stops that agent only
//   page message {to, text}          the bar's "Let <agent> continue": a message to the agent
// The code runs with the app frame's own Function (document and window are the app's) and gets helpers that act the
// way a person would, slowly enough to watch: click, type, press, drag (the agent's pointer moves there first, then
// the events a real hand makes fire), read (what's on screen, as short lines) and wait. Plain DOM code works too.
// What to act on: an element, a CSS selector, its visible text, or a spot {x, y} (window px: whatever is on top there,
// as with a real mouse; for empty space, and see-through layers like Point's).
// What the user sees: the pointer (the agent's colour and name), an outline on each thing touched (also when code
// skips the helpers: any event code makes, isTrusted false, while a run is on), and a notice (top right) while the agent is using
// the page (from its first page_run to the end of its turn). The user's own click or key in the main space or an app
// pauses it: the current helper stops, the agent hears "the user took over", later runs are refused until the user
// presses "Let <agent> continue". While agent code runs, the page's Stop button and rollbacks refuse it.
// What the page sends because of the agent's code (its click, key or drop set off a page message) carries
// {by: <agent>}, so the extension that gets it can say who did it (frames: "agent1 pressed Implement", not "the user").
// A run in a card first brings that card to the front (data-agent-front, until a run in another card) and scrolls it
// into view, so the user sees it. If the app reloads or leaves during a run, the answer comes at once (pagehide).
// The value comes back as short text: an element as tag#id "its text", anything else as JSON, cut at MAX characters.
const MAX = 2000;
const PACE = { moveMin: 280, moveMax: 750, afterClick: 350, keyMin: 40, keyMax: 90, linger: 1100 };
const ACTIVE = "button, a[href], input, select, textarea, summary, label, [role=button], [role=tab], [role=checkbox], [role=radio], "
  + "[role=switch], [role=menuitem], [role=option], [role=link], [role=slider], [contenteditable=''], [contenteditable=true]";
const colour = (a) => `hsl(${([...a].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) * 137) % 360} 65% 45%)`;  // as page.html
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
class TookOver extends Error {}

export default function (page) {
  const tab = Math.random().toString(36).slice(2, 10);
  const claim = () => { try { page.send({ type: "page_tab", tab }); return true; } catch { return false; } };  // false: not connected yet
  const first = () => claim() || setTimeout(first, 300);  // the first status may come before this script loads: don't wait for it
  first();
  page.on("status", () => { if (document.hasFocus()) claim(); });  // status comes again on every reconnect
  addEventListener("focus", claim);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) claim(); });

  const main = page.slot("top");
  let session = null;      // {agent, paused}: from an agent's first page_run to the end of its turn
  let busy = 0, mine = 0;  // runs going on; >0 while a helper fires its own events (they get their own outline)
  let refused = [];        // what the guard refused during the current run
  let codeClicked = false; // the last click on this page came from code
  let byCode = false;      // the last click, key, input or drop came from code

  // every page message goes through page.send (one pageApi for all plugins): while agent code acts, say whose it is
  const send = page.send;
  page.send = (obj) => send(busy && byCode && session ? { ...obj, by: session.agent } : obj);

  // ---------- what the user sees ----------
  const style = document.createElement("style");
  style.textContent = `
    [data-card][data-agent-front] { position: relative; z-index: 3; }  /* a pinned card keeps its inline absolute; a held or flipped one goes higher */
    .page-pointer { position: fixed; left: 0; top: 0; z-index: 2147483000; pointer-events: none; display: flex; gap: 2px;
                    opacity: 0; transition: opacity .3s; will-change: transform; }
    .page-pointer.on { opacity: 1; }
    .page-pointer svg { width: 20px; height: 20px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.25)); }
    .page-pointer span { margin-top: 14px; color: #fff; font: 600 11px system-ui, sans-serif; padding: 2px 7px; border-radius: 7px; }
    .page-touch { position: fixed; z-index: 2147482999; pointer-events: none; border: 2px solid; border-radius: 9px; transition: opacity .5s; }
    .page-touch b { position: absolute; top: -18px; left: -2px; color: #fff; font: 600 10px system-ui, sans-serif; padding: 1px 6px;
                    border-radius: 6px; white-space: nowrap; }
    .page-ripple { position: fixed; z-index: 2147483000; pointer-events: none; width: 36px; height: 36px; margin: -18px 0 0 -18px;
                   border-radius: 50%; border: 2px solid; animation: page-ripple .55s ease-out forwards; }
    @keyframes page-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
    .page-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; animation: page-pulse 1.2s infinite; }
    .page-dot.paused { background: var(--muted, #999) !important; animation: none; }
    @keyframes page-pulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .page-pointer { transition: opacity .1s; } .page-dot { animation: none; } }`;
  document.head.append(style);
  const pointer = Object.assign(document.createElement("div"), { className: "page-pointer" });
  pointer.innerHTML = `<svg viewBox="0 0 20 20"><path d="M3 2 L3 16 L7 12.5 L9.8 18 L12 17 L9.3 11.6 L14.5 11.2 Z" stroke="#fff"
    stroke-width="1.3" stroke-linejoin="round"/></svg><span></span>`;
  let bar = null;  // the notice (pageApi.notice) while an agent uses the page
  document.body.append(pointer);
  let px = innerWidth - 80, py = innerHeight - 80, hideTimer, idleTimer;

  function showBar() {  // new, or the same notice with new words: ✕ hides it for the turn (Close, when paused)
    const a = session.agent;
    if (session.quiet && !session.paused) return;
    const dot = Object.assign(document.createElement("span"), { className: "page-dot" + (session.paused ? " paused" : "") });
    dot.style.background = colour(a);
    const msg = session.paused ? `You took over: ${a} is paused` : `${a} is using the page`;
    const button = (text, go, fn) => Object.assign(document.createElement("button"), { textContent: text, className: go ? "go" : "", onclick: fn });
    const content = [dot, msg, session.paused
      ? button(`Let ${a} continue`, true, () => {
          session.paused = false; session.quiet = false; showBar();
          page.send({ to: a, text: "[from the page] The user is done using the page: carry on where you left off. "
            + "Read the page again first, it may have changed." });
        })
      : button("Stop", false, () => { page.send({ type: "page_stop", agent: a }); endSession(); })];
    if (bar?.open) bar.set(...content);
    else bar = page.notice(content, () => { bar = null; if (!session) return; if (session.paused) endSession(); else session.quiet = true; });
  }
  function endSession() { session = null; bar?.close(); bar = null; pointer.classList.remove("on"); }

  // where an element (or a point in its frame) is in this window, through any app frames (scaled ones too)
  function toTop(doc, x, y) {
    let k = 1;
    for (let w = doc.defaultView; w && w !== window; w = w.parent) {
      const fr = w.frameElement, r = fr.getBoundingClientRect(), s = r.width / (fr.offsetWidth || r.width || 1);
      x = r.left + (fr.clientLeft + x) * s; y = r.top + (fr.clientTop + y) * s; k *= s;
    }
    return { x, y, k };
  }
  function box(el) {
    const r = el.getBoundingClientRect(), p = toTop(el.ownerDocument, r.left, r.top);
    return { x: p.x, y: p.y, w: r.width * p.k, h: r.height * p.k };
  }
  const spot = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; };
  const outlined = new WeakMap();
  function outline(el, label, agent) {
    if (!el?.getBoundingClientRect || Date.now() - (outlined.get(el) ?? 0) < 400) return;  // typing: one outline, not one per letter
    outlined.set(el, Date.now());
    const b = box(el), c = colour(agent), d = Object.assign(document.createElement("div"), { className: "page-touch" });
    Object.assign(d.style, { left: b.x - 3 + "px", top: b.y - 3 + "px", width: b.w + 6 + "px", height: b.h + 6 + "px", borderColor: c,
      background: c.replace(")", " / .09)") });
    const tag = document.createElement("b"); tag.textContent = `${agent} · ${short(label, 40)}`; tag.style.background = c; d.append(tag);
    document.body.append(d);
    setTimeout(() => { d.style.opacity = "0"; }, PACE.linger);
    setTimeout(() => d.remove(), PACE.linger + 600);
  }
  function ripple(x, y, agent) {
    const d = Object.assign(document.createElement("div"), { className: "page-ripple" });
    Object.assign(d.style, { left: x + "px", top: y + "px", borderColor: colour(agent) });
    document.body.append(d); setTimeout(() => d.remove(), 600);
  }

  // ---------- pausing, and the guard ----------
  const gate = () => { if (session?.paused) throw new TookOver(); };
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { gate(); await new Promise((r) => setTimeout(r, Math.min(60, end - Date.now()))); }
    gate();
  }
  function takeOver(e) {
    if (!e.isTrusted || !session || session.paused) return;
    if (e.target.ownerDocument === document && !main.contains(e.target)) return;  // the chat, the palette, the bar: not the page's content
    session.paused = true; pointer.classList.remove("on"); showBar();
  }
  const watched = new WeakSet();
  function watch(doc) {  // the user's real input, and events code makes (outlined), in this document
    if (watched.has(doc)) return;
    watched.add(doc);
    doc.addEventListener("pointerdown", takeOver, true);
    doc.addEventListener("keydown", takeOver, true);
    for (const type of ["click", "keydown", "input", "change", "submit", "drop"]) doc.addEventListener(type, (e) => { byCode = !e.isTrusted; }, true);
    for (const type of ["click", "input", "change", "submit"]) doc.addEventListener(type, (e) => {
      if (!e.isTrusted && busy && !mine && session) outline(e.target, type === "click" ? "clicked" : type === "submit" ? "submitted" : "changed", session.agent);
    }, true);
  }
  watch(document);
  document.addEventListener("click", (e) => {
    codeClicked = !e.isTrusted;
    if (!e.isTrusted && busy && e.target.closest?.("#stop")) {  // Stop acts on the agents: only the user presses it
      e.preventDefault(); e.stopImmediatePropagation(); refused.push("the Stop button: it acts on the agents, so only the user presses it");
    }
  }, true);
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    if (busy && codeClicked && /\/version\/[^/?]+\/rollback/.test(String(input?.url ?? input))) {
      refused.push("a rollback: it changes the agents' code, so only the user starts it");
      return Promise.reject(new Error("refused: only the user rolls back"));
    }
    return realFetch.call(this, input, init);
  };

  // ---------- the helpers an agent's code gets ----------
  function helpers(doc, agent) {
    const w = doc.defaultView;
    function fire(el, type, init = {}) {
      const C = type.startsWith("pointer") ? w.PointerEvent : type.startsWith("key") ? w.KeyboardEvent
        : type === "input" ? w.InputEvent : /^(drag|drop)/.test(type) ? w.DragEvent
        : /^(mouse|click|dblclick)/.test(type) ? w.MouseEvent : w.Event;
      const bubbles = !/^(pointerenter|pointerleave|mouseenter|mouseleave|focus|blur)$/.test(type);
      mine++;
      try { return el.dispatchEvent(new C(type, { bubbles, cancelable: true, composed: true, view: w, ...init })); } finally { mine--; }
    }
    const label = (el) => norm(el.getAttribute?.("aria-label") || el.placeholder || (el.labels?.[0]?.innerText) || el.innerText || el.value || el.title || el.alt || "");
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && w.getComputedStyle(el).visibility !== "hidden"; };
    // A spot {x, y} (window px of this document, as screen_see shows them) is where a real mouse would be: the thing on
    // top there gets the events (a see-through layer like Point's, empty main space), at exactly that spot.
    const isSpot = (t) => typeof t?.x === "number" && typeof t?.y === "number" && !t.nodeType;
    function find(t, typing) {
      if (t?.nodeType === 1) return t;
      if (isSpot(t)) {
        const el = doc.elementFromPoint(t.x, t.y);
        if (!el) throw new Error(`nothing at x ${t.x}, y ${t.y}: the window is ${w.innerWidth}x${w.innerHeight}`);
        return el;
      }
      if (typeof t !== "string" || !t) throw new Error("name what to act on: an element, a CSS selector, or its visible text");
      try { const el = doc.querySelector(t); if (el) return el; } catch {}  // not a selector: it's text
      const want = norm(t).toLowerCase();
      const fields = [...doc.querySelectorAll("input, textarea, select, [contenteditable=''], [contenteditable=true]")].filter(visible);
      const pool = typing ? fields : [...doc.querySelectorAll(ACTIVE), ...doc.querySelectorAll("body *")].filter(visible);
      const names = (el) => [label(el), norm(el.innerText), el.name, el.id].filter(Boolean).map((s) => s.toLowerCase());
      for (const test of [(s) => s === want, (s) => s.startsWith(want), (s) => s.includes(want)]) {
        const hit = pool.find((el) => (typing || !el.children.length || el.matches(ACTIVE)) && names(el).some(test));
        if (hit) return typing ? hit : (hit.closest(ACTIVE) ?? hit);
      }
      if (typing) { const lab = [...doc.querySelectorAll("label")].find((l) => norm(l.innerText).toLowerCase().includes(want)); if (lab?.control) return lab.control; }
      throw new Error(`nothing ${typing ? "to type into " : ""}on the page matches "${t}": read() lists what's there`);
    }
    async function reveal(el) {
      const r = el.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= w.innerHeight && r.left >= 0 && r.right <= w.innerWidth) return;
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      await sleep(450);
    }
    async function moveTo(el, target) {  // target a spot: go exactly there (it is in the window already: no scrolling)
      gate();
      if (!isSpot(target)) await reveal(el);
      const s = isSpot(target) ? { x: target.x, y: target.y } : spot(el), p = toTop(doc, s.x, s.y);
      pointer.querySelector("path").setAttribute("fill", colour(agent));
      Object.assign(pointer.querySelector("span"), { textContent: agent }).style.background = colour(agent);
      pointer.classList.add("on"); clearTimeout(hideTimer);
      const ms = Math.max(PACE.moveMin, Math.min(PACE.moveMax, Math.hypot(p.x - px, p.y - py) * 1.3));
      pointer.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1), opacity .3s`;
      pointer.style.transform = `translate(${p.x}px, ${p.y}px)`; px = p.x; py = p.y;
      await sleep(ms + 80);
      return { s, p };
    }
    const at = (s, extra = {}) => ({ clientX: s.x, clientY: s.y, pointerId: 1, pointerType: "mouse", isPrimary: true, ...extra });
    function press1(el, s) {  // the events of one real click, in order
      fire(el, "pointerover", at(s)); fire(el, "pointerenter", at(s)); fire(el, "mouseover", at(s));
      fire(el, "pointermove", at(s)); fire(el, "mousemove", at(s));
      fire(el, "pointerdown", at(s, { buttons: 1 })); fire(el, "mousedown", at(s, { buttons: 1, detail: 1 }));
      if (el.matches(ACTIVE) || el.tabIndex >= 0) el.focus({ preventScroll: true });
      fire(el, "pointerup", at(s)); fire(el, "mouseup", at(s, { detail: 1 })); fire(el, "click", at(s, { detail: 1 }));
    }
    const valueSetter = (el) => Object.getOwnPropertyDescriptor(w[el.localName === "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement"].prototype, "value").set;
    const keyInit = (key) => {
      const parts = key.split("+"), k = parts.pop() || "+", has = (m) => parts.some((p) => p.toLowerCase() === m);
      const code = k.length === 1 ? (/[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : /\d/.test(k) ? `Digit${k}` : k === " " ? "Space" : "") : k;
      return { key: k === "Space" ? " " : k, code, ctrlKey: has("ctrl") || has("control"), shiftKey: has("shift"), altKey: has("alt"), metaKey: has("meta") || has("cmd") };
    };

    const api = {
      async click(target) {
        const el = find(target), { s, p } = await moveTo(el, target);
        ripple(p.x, p.y, agent); press1(el, s); outline(el, label(el) || el.localName, agent);
        await sleep(PACE.afterClick);
      },
      async type(target, text, { add = false } = {}) {
        let el = find(target, true);
        const { s, p } = await moveTo(el, target);
        ripple(p.x, p.y, agent); press1(el, s);
        text = String(text);
        if (isSpot(target)) {  // as a keyboard would: into what the click focused, else as keys to the page (Text's words)
          await sleep(120);
          const f = doc.activeElement;
          if (f?.matches?.("input, textarea, select") || f?.isContentEditable) el = f;
          else {
            for (const ch of text) {
              gate();
              const k = keyInit(ch === "\n" ? "Enter" : ch === " " ? "Space" : ch);
              fire(f ?? doc.body, "keydown", k); fire(f ?? doc.body, "keyup", k);
              await sleep(PACE.keyMin + Math.random() * (PACE.keyMax - PACE.keyMin));
            }
            outline(el, `typed "${short(text, 24)}"`, agent);
            return sleep(PACE.afterClick);
          }
        }
        if (el.localName === "select") {  // a dropdown: pick the option with that text (or value)
          const o = [...el.options].find((o) => norm(o.text).toLowerCase() === norm(text).toLowerCase() || o.value === text);
          if (!o) throw new Error(`"${label(el)}" has no option "${text}": ${[...el.options].map((o) => o.text).join(", ")}`);
          el.value = o.value; fire(el, "input"); fire(el, "change"); outline(el, `picked "${o.text}"`, agent);
          return sleep(PACE.afterClick);
        }
        const editable = el.isContentEditable, set = editable ? null : valueSetter(el);
        if (/^(range|color|date|time|datetime-local|month|week)$/.test(el.type)) {  // no letters to type: set it, as a slider drag or picker would
          set.call(el, text); fire(el, "input"); fire(el, "change"); outline(el, `set to ${short(text, 24)}`, agent);
          return sleep(PACE.afterClick);
        }
        if (!add) {
          if (editable) { mine++; try { doc.execCommand("selectAll"); doc.execCommand("delete"); } finally { mine--; } }
          else if (el.value) { set.call(el, ""); fire(el, "input", { inputType: "deleteContentBackward" }); }
        }
        for (const ch of text) {
          gate();
          const k = keyInit(ch === "\n" ? "Enter" : ch === " " ? "Space" : ch);
          fire(el, "keydown", k);
          if (editable) { mine++; try { doc.execCommand("insertText", false, ch); } finally { mine--; } }
          else { set.call(el, el.value + ch); fire(el, "input", { inputType: "insertText", data: ch }); }
          fire(el, "keyup", k);
          outline(el, `typing "${short(text, 24)}"`, agent);
          await sleep(PACE.keyMin + Math.random() * (PACE.keyMax - PACE.keyMin));
        }
        fire(el, "change");
        await sleep(PACE.afterClick);
      },
      async press(key, target) {
        const el = target ? find(target) : doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body;
        if (target) await moveTo(el, target);
        gate();
        const k = keyInit(key), go = fire(el, "keydown", k);
        if (go) {  // what a browser does by itself for a real key, which events from code don't trigger
          const field = el.localName === "input" && !/^(button|submit|checkbox|radio|reset)$/.test(el.type);
          if (k.key === "Enter" && field && el.form) { mine++; try { el.form.requestSubmit(); } finally { mine--; } }
          else if ((k.key === "Enter" || k.key === " ") && el.matches("button, a[href], [role=button], summary, input[type=checkbox], input[type=radio], input[type=submit]")) press1(el, spot(el));
          else if (k.key === "Tab") {
            const all = [...doc.querySelectorAll(ACTIVE)].filter((e) => visible(e) && !e.disabled && e.tabIndex >= 0);
            const i = all.indexOf(el), next = all[(i + (k.shiftKey ? -1 : 1) + all.length) % all.length];
            next?.focus();
          }
        }
        fire(el, "keyup", k);
        outline(el, `pressed ${key}`, agent);
        await sleep(PACE.afterClick);
      },
      async drag(target, dx, dy = 0) {  // by dx, dy px, or onto another thing or a spot: drag(a, b)
        const el = find(target), { s } = await moveTo(el, target);
        const to = typeof dx === "number" ? { x: s.x + dx, y: s.y + dy } : isSpot(dx) ? { x: dx.x, y: dx.y } : spot(find(dx));
        // A draggable thing (draggable="true", e.g. a file row) moves by the browser's drag-and-drop, which code
        // can't start: fire its events ourselves, with one DataTransfer from dragstart to drop, as the browser would.
        const source = el.closest('[draggable="true"]'), data = source && new w.DataTransfer();
        fire(el, "pointerdown", at(s, { buttons: 1 })); fire(el, "mousedown", at(s, { buttons: 1 }));
        const dragging = source && fire(source, "dragstart", at(s, { buttons: 1, dataTransfer: data }));  // cancelled: no drag
        let over = el, accepted = false;
        for (let i = 1; i <= 12; i++) {
          const q = { x: s.x + (to.x - s.x) * i / 12, y: s.y + (to.y - s.y) * i / 12 }, p = toTop(doc, q.x, q.y);
          pointer.style.transition = "transform 40ms linear, opacity .3s"; pointer.style.transform = `translate(${p.x}px, ${p.y}px)`; px = p.x; py = p.y;
          const now = doc.elementFromPoint(q.x, q.y) ?? el;
          if (dragging) {
            if (now !== over) { fire(over, "dragleave", at(q, { dataTransfer: data })); fire(now, "dragenter", at(q, { buttons: 1, dataTransfer: data })); }
            accepted = !fire(now, "dragover", at(q, { buttons: 1, dataTransfer: data }));  // a drop target cancels dragover
          } else { fire(now, "pointermove", at(q, { buttons: 1 })); fire(now, "mousemove", at(q, { buttons: 1 })); }
          over = now;
          await sleep(45);
        }
        if (dragging) {
          if (accepted) fire(over, "drop", at(to, { dataTransfer: data }));
          fire(source, "dragend", at(to, { dataTransfer: data }));
        } else { fire(over, "pointerup", at(to)); fire(over, "mouseup", at(to)); }
        outline(el, accepted ? "dragged and dropped" : "dragged", agent);
        await sleep(PACE.afterClick);
      },
      read(target, { all = false } = {}) {  // what's on screen: headings, controls (with value and state), short texts
        const root = target ? find(target) : doc.body, lines = [];
        // the conversation (#log) and the working rows are what the agent already knows, and on Chalky's page they
        // drown out the rest: left out, unless asked for by name (read("#log"))
        const known = doc === document && !root.closest("#log, #working") ? "#log, #working" : null;
        let out = 0;
        for (const el of [...(target ? [root] : []), ...root.querySelectorAll("*")]) {
          if (el.closest("script, style, template, noscript") || (known && el.closest(known))) continue;
          const control = el.matches(ACTIVE) && el.localName !== "label", heading = /^h[1-6]$/.test(el.localName);
          const text = !el.children.length ? norm(el.innerText) : "";
          if (!control && !heading && !(text && text.length <= 80)) continue;
          if (!control && el.parentElement?.closest(ACTIVE)) continue;  // text inside a button: the button says it
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (!all && (r.bottom < 0 || r.top > w.innerHeight)) { out++; continue; }
          if (lines.length >= 80) { out++; continue; }
          const tag = el.localName, role = el.getAttribute("role");
          const kind = heading ? "heading" : tag === "input" ? `input ${el.type}` : control ? (role ?? tag) : "text";
          const state = [el.checked && "checked", el.disabled && "disabled", el.getAttribute("aria-selected") === "true" && "selected",
            el.getAttribute("aria-pressed") === "true" && "pressed", el.getAttribute("aria-checked") === "true" && "checked"].filter(Boolean);
          const value = /^(input|textarea|select)$/.test(tag) && !/^(checkbox|radio|button|submit)$/.test(el.type) ? ` = ${JSON.stringify(short(el.value, 60))}` : "";
          lines.push(`${kind} "${short(label(el) || norm(el.innerText), 70)}"${value}${state.length ? ` [${state.join(", ")}]` : ""}`);
        }
        return lines.join("\n") + (out ? `\n(+${out} more out of view: scroll, or read(${target ? "target, " : "null, "}{all: true}))` : "");
      },
      async wait(what, timeout = 5000) {  // ms, a CSS selector to appear, or a function to become true
        if (typeof what === "number") return sleep(what);
        const test = typeof what === "string" ? () => doc.querySelector(what) : what, end = Date.now() + timeout;
        for (;;) {
          const v = await test();
          if (v) return v;
          if (Date.now() > end) throw new Error(`wait: still not there after ${timeout} ms`);
          await sleep(100);
        }
      },
    };
    return api;
  }

  // ---------- running a page_run ----------
  page.on("page_run", async ({ req, tab: target, card, code, agent = "agent1" }) => {
    if (target !== tab) return;
    const answer = (a) => page.send({ type: "page_ran", req, errors: [], ...a });
    if (session?.paused) return answer({ error: `the user has taken over the page: wait until they press "Let ${session.agent} continue" (you get a message)` });
    let w = window;
    if (card) {
      const el = document.querySelector(`[data-card="${CSS.escape(card)}"]`);
      if (!el) return answer({ error: `no card "${card}" on the page` });
      const fr = el.querySelector("iframe");
      if (!fr) return answer({ error: `card "${card}" shows blocks, not an app: run without card and start from document.querySelector('[data-card="${card}"]')` });
      try { fr.contentDocument.body; w = fr.contentWindow; } catch { return answer({ error: `card "${card}" shows another site: its page can't be reached` }); }
      if (el.closest(".board:not(.on)")) code = `/* not on the board the user is looking at */\n${code}`;
      else {  // in front of the other cards, and in view
        for (const o of document.querySelectorAll("[data-agent-front]")) if (o !== el) o.removeAttribute("data-agent-front");
        el.setAttribute("data-agent-front", "");
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
          el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
          await new Promise((ok) => setTimeout(ok, 450));
        }
      }
    }
    if (!session || session.agent !== agent) session = { agent, paused: false };
    showBar();
    for (const fr of main.querySelectorAll("iframe")) try { if (fr.contentDocument) watch(fr.contentDocument); } catch {}
    const errors = [], onError = (e) => errors.push(String(e.error?.stack ?? e.message ?? e).split("\n").slice(0, 3).join("\n"));
    const onReject = (e) => errors.push(`unhandled rejection: ${e.reason?.message ?? e.reason}`);
    const consoleError = w.console.error;
    w.addEventListener("error", onError);
    w.addEventListener("unhandledrejection", onReject);
    w.console.error = (...args) => { errors.push(args.map(String).join(" ")); consoleError.apply(w.console, args); };
    busy++; refused = []; clearTimeout(hideTimer);
    const h = helpers(w.document, agent);
    let settled = false;
    const finish = (a) => {  // once: the code ended, or the page it ran in went away (then the code never ends)
      if (settled) return;
      settled = true;
      answer({ ...a, errors: [...errors, ...refused.map((r) => `refused ${r}`)] });
      busy--;
      w.removeEventListener("error", onError);
      w.removeEventListener("unhandledrejection", onReject);
      w.removeEventListener("pagehide", onLeave);
      w.console.error = consoleError;
      hideTimer = setTimeout(() => pointer.classList.remove("on"), 2500);
      clearTimeout(idleTimer);  // no turn behind it (curl), or a turn that never ends: the bar goes after a quiet minute
      idleTimer = setTimeout(() => { if (session && !session.paused && !busy) endSession(); }, 60000);
    };
    const onLeave = () => finish({ value: "the app reloaded (or left its page): the code after that didn't run; continue in a new page_run" });
    w.addEventListener("pagehide", onLeave);
    try {
      const value = await new w.Function("click", "type", "press", "drag", "read", "wait", `return (async () => {\n${code}\n})()`)(
        h.click, h.type, h.press, h.drag, h.read, h.wait);
      finish({ value: describe(value) });
    } catch (e) {
      finish({ error: e instanceof TookOver ? `the user took over the page (they clicked or typed): stop here and wait; when they press "Let ${agent} continue" you get a message`
        : e?.name ? `${e.name}: ${e.message}` : String(e) });  // the stack only points into this file
    }
  });
  page.on("run_end", ({ agent }) => { if (session?.agent === agent && !session.paused) endSession(); });  // paused: the bar stays, to continue
}

// An element (from any frame: no instanceof) as tag#id.class "its text"
function element(el) {
  const id = el.id ? `#${el.id}` : "", cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
  const text = norm(el.innerText ?? el.textContent ?? "");
  const value = "value" in el && el.value !== "" && el.localName !== "button" ? ` = ${JSON.stringify(el.value)}` : "";
  return `${el.localName}${id}${cls}${text ? ` "${short(text, 60)}"` : ""}${value}`;
}
function describe(v) {
  if (v === undefined) return "done (nothing returned)";
  if (v?.nodeType === 1) return element(v);
  if (v && typeof v === "object" && typeof v.length === "number" && v.length && [...v].every((x) => x?.nodeType === 1)) v = [...v].map(element);
  let s;
  try { s = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (x?.nodeType === 1 ? element(x) : x), 1); } catch { s = String(v); }
  return s.length > MAX ? s.slice(0, MAX) + `… (${s.length} characters, cut)` : s;
}
