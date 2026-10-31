// Browser half of the ui plugin (a page script, see chat_ui.py). Draws UI surfaces in the "top" slot
// (the page's main space). A surface is the record described at the top of ui.py.
// A surface is bare: only what the agent built, no frame (its label shows on hover: name, owner, ✕). It is
// stacked in the main space, its content keeping its own size; or pinned at place {x, y, width?, height?}
// (px from the main space's top-left, so it scrolls with the page), its root component then filling it.
// What the user can do with the label (the handle, so clicks inside still work):
//   drag          move it; a drop sends {type: "ui_move", surface, place} (unless draggable: false)
//   drag and hold still over another surface (it lights up), release   combine: it slides back and the page
//                 fires a "ui-combine" DOM event. A plain drop over another surface just moves it (they overlap)
//                 {a, b, x, y} (point.js opens a note box; the agent then changes b, and a stays).
//                 Onto a pinned surface: refused (it would change), with a note in the chat
//   hold          pin or unpin it ({type: "ui_pin"}): agents can't change a pinned surface, and it stays put
//   double-click  turn it over: the back side shows what it is for (about), what it was made from, and
//                 each component's levers (sentences from its about block; the words in them change it)
//   ✕             close it; if other surfaces read from it, the label asks first (they get a copy)
// The corner resizes it (unless resizable: false). Moving or resizing one first pins every stacked surface
// where it is (else the ones below would jump up).
// Typing into a bound field changes the data at once and sends {type: "ui_set"} shortly after: saved, and
// no agent is woken; so does a click on a Button with set (ui.write). A component with
// when: {"path", "is"} is hidden while that data is something else (tabs, steps, "show more"). Props can read other surfaces' data ({"ref", "path"}); those redraw when it changes.
// Alternatives (options): drawn as a stack with a bar to flip through them; "Keep" sends {type: "ui_keep"}.
// Components come from the page's catalog (page.load defines <ui-name>; see chat_ui.html); one saved with
// an older version of its props goes through the component's upgrade(props, fromVersion) first.
// Elements are kept per id across redraws, so a component keeps its state (focus, a running game).
const get = (data, path) => path.split("/").filter(Boolean).reduce((o, k) => o?.[k], data);
const isBinding = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).join() === "path";
const isRef = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "path,ref";
const propsOf = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !["id", "component", "children", "child", "when"].includes(k)));
const refsIn = (s) => new Set(s.components.flatMap((c) => Object.values(propsOf(c)).filter(isRef).map((v) => v.ref)));
const HOLD_MS = 550;  // hold the label this long, without moving, to pin or unpin
const COMBINE_MS = 600;  // hold a dragged surface still over another this long to combine with it

const CSS = `
  [data-surface] { position: relative; display: flex; flex-direction: column; width: fit-content; max-width: 100%; margin: 0 0 20px; }
  [data-surface] > .surface-body { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; }
  [data-surface] > .surface-body > * { max-width: 100%; }
  [data-surface] > .surface-body [hidden] { display: none !important; }
  [data-surface][data-placed] > .surface-body { align-items: stretch; }
  [data-surface][data-placed] > .surface-body > * { flex: 1; min-height: 0; }
  [data-surface] > .surface-label { position: absolute; bottom: 100%; left: 0; z-index: 2; display: flex; gap: 8px; align-items: center;
    padding: 2px 8px; border-radius: 8px; font-size: 11px; white-space: nowrap; color: var(--muted, #888); cursor: grab;
    background: var(--glass-strong, #fff); opacity: 0; pointer-events: none; transition: opacity 0.15s; user-select: none; }
  [data-surface]:hover > .surface-label, [data-surface] > .surface-label.asking { opacity: 1; pointer-events: auto; }
  [data-surface] > .surface-label button { color: inherit; font: inherit; background: none; border: 0; cursor: pointer; padding: 0 2px; }
  [data-surface] > .surface-label .ask { color: var(--ink, #1d1d1f); }
  [data-surface] > .surface-resize { position: absolute; right: 0; bottom: 0; z-index: 1; width: 10px; height: 10px;
    border: solid var(--muted, #888); border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; cursor: nwse-resize;
    opacity: 0; pointer-events: none; transition: opacity 0.15s; }
  [data-surface]:hover > .surface-resize { opacity: 1; pointer-events: auto; }
  [data-surface][data-pinned] { outline: 2px solid #d4691e; outline-offset: 4px; border-radius: 6px; }
  [data-surface][data-pinned] > .surface-label { cursor: default; }
  [data-surface][data-pinned] > .surface-resize { display: none; }
  [data-surface][data-drop] { outline: 3px solid var(--accent, #0071e3); outline-offset: 4px; border-radius: 6px; }
  [data-surface][data-flipped] { z-index: 5; }  /* the back side stays above its neighbours */
  [data-surface][data-flipped] > .surface-body { visibility: hidden; }
  [data-surface] > .surface-back { position: absolute; left: 0; top: 0; z-index: 1; box-sizing: border-box; min-width: 260px; min-height: 100%;
    max-width: 420px; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; color: #e8eeea; background: #1f2a25;
    box-shadow: 0 8px 30px rgba(0,0,0,.18); display: flex; flex-direction: column; gap: 8px; }
  [data-surface] > .surface-back p { margin: 0; }
  [data-surface] > .surface-back ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  [data-surface] > .surface-back .lever { font: inherit; color: #1f2a25; background: #f4d35e; border: 0; border-radius: 4px;
    padding: 0 5px; cursor: pointer; outline-offset: 1px; }
  [data-surface] > .surface-back span.lever { cursor: text; }
  [data-surface] > .surface-back .lever.ref { background: #c7d3cd; cursor: default; }
  [data-surface] > .surface-back .muted { opacity: .7; }
  [data-surface] > .surface-back > button { align-self: flex-start; font: inherit; color: inherit; background: none;
    border: 1px solid currentColor; border-radius: 8px; padding: 3px 10px; cursor: pointer; }
  [data-surface][data-options] > .surface-body { box-shadow: 8px 8px 0 -2px rgba(0,0,0,.07), 16px 16px 0 -4px rgba(0,0,0,.05); border-radius: 10px; }
  [data-surface] > .surface-options { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; font-size: 12px; color: var(--muted, #888); }
  [data-surface] > .surface-options button { font: inherit; color: inherit; background: var(--glass-strong, #fff);
    border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 1px 8px; cursor: pointer; }
  [data-surface] > .surface-options button.keep { color: #fff; background: var(--accent, #0071e3); border-color: transparent; }`;

function setPath(data, path, value) {
  const keys = path.split("/").filter(Boolean), last = keys.pop();
  for (const k of keys) data = data[k] ??= {};
  data[last] = value;
}

function el(tag, attrs = {}, ...children) {  // a small element builder (textContent, never innerHTML, for data)
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "text" ? (e.textContent = v) : k.startsWith("on") ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...children);
  return e;
}

export default async function (page) {
  if (!page.load) return;  // an older page (e.g. a Versions preview) without the component runtime
  document.head.insertAdjacentHTML("beforeend", `<style id="ui-surface-css">${CSS}</style>`);
  const area = page.slot("top");
  const surfaces = {};  // id -> the record from ui.py, plus what only this page has: box, body, nodes, flipped, option
  let abouts = {}, mtimes = {};
  const modules = {};   // component name -> its module (for upgrade())
  const loadAbouts = async () => {
    try { [abouts, mtimes] = await Promise.all(["/ui-api/about", "/ui-api/catalog"].map(async (u) => (await fetch(u)).json())); } catch {}
  };
  page.on("version", loadAbouts);  // an agent may have changed a component
  const pending = {};   // "surface path" -> timer: ui_set waits until the typing pauses
  const sendSet = (id, path, value) => {
    clearTimeout(pending[`${id} ${path}`]);
    pending[`${id} ${path}`] = setTimeout(() => page.send({ type: "ui_set", surface: id, path, value }), 500);
  };

  async function upgraded(name, props, s) {  // props saved with an older about.version: through upgrade() first
    const from = s.kinds?.[name], now = abouts[name]?.version;
    if (!from || !now || from >= now) return props;
    try {
      const mod = await (modules[name] ??= import(`/ui/components/${name}.js?v=${mtimes[name]}`));
      return mod.upgrade ? mod.upgrade(props, from) : props;
    } catch (e) { console.warn(`upgrade of ${name}:`, e); return props; }
  }

  async function draw(id, chain = new Set()) {
    const s = surfaces[id];
    if (!s || chain.has(id)) return;  // chain: surfaces reading from each other are drawn once each
    chain.add(id);
    if (!s.box) {  // the surface, with a label (name, pin, ✕) that shows on hover
      s.box = el("div");
      s.box.dataset.surface = id;  // lets the page work out what a click points at (point.js)
      s.label = el("div", { class: "surface-label" });
      s.body = el("div", { class: "surface-body" });
      s.box.append(s.label, s.body, el("div", { class: "surface-resize", title: "Drag to resize", onpointerdown: (e) => resize(s, id, e) }));
      s.label.onpointerdown = (e) => drag(s, id, e);
      s.label.ondblclick = () => { s.flipped = !s.flipped; draw(id); };
      s.nodes = {};
      area.append(s.box);
    }
    drawLabel(s, id);
    s.box.dataset.owner = s.owner;  // who a note on this surface goes to (point.js)
    s.box.dataset.board = s.board ?? 1;  // its board: boards/browser.js shows it there
    s.box.querySelector(".surface-resize").hidden = s.resizable === false;
    s.box.toggleAttribute("data-pinned", !!s.pinned);
    s.box.toggleAttribute("data-flipped", !!s.flipped);
    s.box.toggleAttribute("data-options", !!s.options);
    const p = s.place;
    s.box.toggleAttribute("data-placed", !!p);
    Object.assign(s.box.style, p ? { position: "absolute", left: `${p.x}px`, top: `${p.y}px`, margin: "0",
                                     width: p.width ? `${p.width}px` : "", height: p.height ? `${p.height}px` : "" }
                                 : { position: "", left: "", top: "", margin: "", width: "", height: "" });
    drawOptionsBar(s, id);
    const shown = s.options ? s.options[s.option ?? 0] : s;  // an alternative, or the surface itself
    try {
      for (const c of shown.components) if (!(await page.load(c.component))) throw new Error(`no component ${c.component}`);
    } catch (e) {
      s.body.textContent = `Could not load a component: ${e}`;
      return;
    }
    const byId = Object.fromEntries(shown.components.map((c) => [c.id, c]));
    const resolve = (v) => (isBinding(v) ? get(shown.data, v.path) : isRef(v) ? get(surfaces[v.ref]?.data ?? {}, v.path) : v);
    const props = {};
    for (const c of shown.components) props[c.id] = await upgraded(c.component, Object.fromEntries(
      Object.entries(propsOf(c)).map(([k, v]) => [k, resolve(v)])), s);

    const build = (cid) => {
      const c = byId[cid], tag = `ui-${c.component.toLowerCase()}`;
      const node = s.nodes[cid]?.localName === tag ? s.nodes[cid] : document.createElement(tag);
      s.nodes[cid] = node;
      node.dataset.cid = cid;
      const children = (c.children || (c.child ? [c.child] : [])).map(build);
      node.update(props[cid], {
        children,
        mount(container) {  // only re-insert children when they changed (moving a node loses its focus)
          if (container.children.length !== children.length || children.some((ch, i) => container.children[i] !== ch))
            container.replaceChildren(...children);
        },
        set(prop, value) {  // write a bound prop into the data: at once here, saved shortly after (ui_set)
          if (!isBinding(c[prop])) return;  // a plain value or another surface's data: not this field's to write
          setPath(shown.data, c[prop].path, value);
          if (!s.options) sendSet(id, c[prop].path, value);
          draw(id);
        },
        data: shown.data,  // this surface's data, to read (write through set or write)
        write(values) {  // {path: value, ...} into this surface's data: at once here, saved shortly after (ui_set)
          for (const [path, value] of Object.entries(values)) {
            setPath(shown.data, path, value);
            if (!s.options) sendSet(id, path, value);
          }
          draw(id);
        },
        action(name, context = {}) {
          const ctx = Object.fromEntries(Object.entries(context).map(([k, v]) => [k, resolve(v)]));
          page.send({ type: "ui_action", surface: id, component: cid, name, context: ctx, data: s.data });
        },
      });
      node.hidden = !!c.when && get(shown.data, c.when.path) !== c.when.is;  // shown only while its data matches
      return node;
    };
    try {
      const root = build("root");
      if (s.body.firstChild !== root) s.body.replaceChildren(root);
    } catch (e) {
      s.body.textContent = `Could not draw this surface: ${e}`;
    }
    drawBack(s, id, shown, resolve);
    for (const [other, o] of Object.entries(surfaces)) if (o.components && refsIn(o).has(id)) draw(other, chain);
  }

  function drawLabel(s, id) {  // name · owner, pinned or not, ✕ (which asks first if others read from it)
    const users = Object.keys(surfaces).filter((o) => o !== id && surfaces[o].components && refsIn(surfaces[o]).has(id));
    s.label.classList.remove("asking");
    s.label.replaceChildren(
      el("span", { text: `${id} · ${s.owner}${s.pinned ? " · pinned" : ""}`, title: "Drag to move; hold still over another to combine; hold to pin; double-click to turn over" }),
      el("button", { text: "✕", title: "Close", onclick: () => {
        if (!users.length) return page.send({ type: "ui_close", surface: id });
        s.label.classList.add("asking");
        s.label.replaceChildren(
          el("span", { class: "ask", text: `${users.join(", ")} ${users.length > 1 ? "read" : "reads"} from this. Copy it in, then close?` }),
          el("button", { text: "Copy & close", onclick: () => page.send({ type: "ui_close", surface: id }) }),
          el("button", { text: "Cancel", onclick: () => drawLabel(s, id) }));
      } }));
  }

  function drawOptionsBar(s, id) {
    s.box.querySelector(".surface-options")?.remove();
    if (!s.options) return;
    const i = s.option ?? 0, n = s.options.length;
    const flip = (d) => { s.option = (i + d + n) % n; draw(id); };
    const bar = el("div", { class: "surface-options" },
      el("button", { text: "‹", title: "Previous", "aria-label": "Previous option", onclick: () => flip(-1) }),
      el("span", { text: `${i + 1} of ${n}: ${s.options[i].label}` }),
      el("button", { text: "›", title: "Next", "aria-label": "Next option", onclick: () => flip(1) }),
      el("button", { class: "keep", text: "Keep this", onclick: () => page.send({ type: "ui_keep", surface: id, index: i }) }));
    bar.onwheel = (e) => { e.preventDefault(); flip(Math.sign(e.deltaY || e.deltaX)); };
    s.box.insertBefore(bar, s.body);
  }

  function drawBack(s, id, shown, resolve) {  // the back side: about, made from, levers, pinned
    s.box.querySelector(".surface-back")?.remove();
    if (!s.flipped) return;
    const back = el("div", { class: "surface-back" }, el("b", { text: `How ${id} works` }),
      el("p", { class: s.about ? "" : "muted", text: s.about || "No description yet. Ask its agent to write one." }));
    if (s.made_from) back.append(el("p", { text: `Made from ${s.made_from.join(" and ")}` + (s.instruction ? `: “${s.instruction}”` : ".") }));
    const list = el("ul");
    for (const c of shown.components) {
      const spec = abouts[c.component];
      for (const sentence of spec?.levers || []) {
        const li = el("li", {}, el("span", { class: "muted", text: `${c.id}: ` }));
        for (const [i, part] of sentence.split(/\{(\w+)\}/).entries()) li.append(i % 2 ? lever(s, id, shown, c, part, spec.props?.[part] || {}, resolve) : part);
        list.append(li);
      }
    }
    if (list.children.length) back.append(list);
    back.append(el("p", {}, "It is ", el("button", { class: "lever", text: s.pinned ? "pinned" : "not pinned",
      onclick: () => page.send({ type: "ui_pin", surface: id, pinned: !s.pinned }) }),
      `: agents ${s.pinned ? "can't" : "may"} change it.`));
    back.append(el("button", { text: "Turn back", onclick: () => { s.flipped = false; draw(id); } }));
    s.box.append(back);
  }

  function lever(s, id, shown, c, prop, spec, resolve) {  // one {prop} of a lever sentence: a control
    const raw = c[prop], value = resolve(raw) ?? spec.default ?? "";
    if (isRef(raw)) return el("span", { class: "lever ref", text: String(value), title: `read from ${raw.ref}` });
    const commit = (v) => {
      if (isBinding(raw)) { setPath(shown.data, raw.path, v); page.send({ type: "ui_set", surface: id, path: raw.path, value: v }); }
      else { c[prop] = v; page.send({ type: "ui_prop", surface: id, component: c.id, prop, value: v }); }
      draw(id);
    };
    if (spec.type === "choice" && spec.options?.length)
      return el("button", { class: "lever", text: String(value), onclick: () => commit(spec.options[(spec.options.indexOf(value) + 1) % spec.options.length]) });
    if (spec.type === "boolean") return el("button", { class: "lever", text: value ? "yes" : "no", onclick: () => commit(!value) });
    if (spec.type === "text" || spec.type === "number") {
      const span = el("span", { class: "lever", contenteditable: "true", spellcheck: "false", text: String(value) });
      span.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); span.blur(); } };
      span.onblur = () => {
        const v = spec.type === "number" ? Number(span.textContent.trim()) : span.textContent.trim();
        if (v !== value && !(spec.type === "number" && Number.isNaN(v))) commit(v);
      };
      return span;
    }
    return el("span", { class: "lever ref", text: JSON.stringify(value) });  // lists, objects: shown, changed by the agent
  }

  page.on("ui", (ev) => {
    if (ev.op === "render") {
      const old = surfaces[ev.surface] || {};
      const { op, type, surface, ...record } = ev;
      surfaces[ev.surface] = { ...record, box: old.box, label: old.label, body: old.body, nodes: old.nodes,
                               flipped: old.flipped, option: record.options ? old.option : 0 };
      draw(ev.surface);
    } else if (ev.op === "delete" && surfaces[ev.surface]) {
      surfaces[ev.surface].box?.remove();
      delete surfaces[ev.surface];
      for (const id of Object.keys(surfaces)) drawLabel(surfaces[id], id);
    } else if (ev.op === "reset") {  // a whole saved state (undo, redo, rewind)
      for (const id of Object.keys(surfaces)) if (!(id in ev.surfaces)) { surfaces[id].box?.remove(); delete surfaces[id]; }
      for (const [id, record] of Object.entries(ev.surfaces)) {
        const old = surfaces[id] || {};
        surfaces[id] = { ...record, box: old.box, label: old.label, body: old.body, nodes: old.nodes, flipped: old.flipped, option: 0 };
      }
      for (const id of Object.keys(surfaces)) draw(id);
    }
  });

  function pinStacked() {  // pin each stacked surface where it is now, so taking one out of the stack moves none
    const stacked = Object.entries(surfaces).filter(([, s]) => !s.place && s.box);
    for (const [, s] of stacked) s.place = { x: s.box.offsetLeft, y: s.box.offsetTop };  // read all, then move
    for (const [id, s] of stacked) {
      s.box.toggleAttribute("data-placed", true);
      Object.assign(s.box.style, { position: "absolute", margin: "0", left: `${s.place.x}px`, top: `${s.place.y}px` });
      page.send({ type: "ui_move", surface: id, place: s.place });
    }
  }

  function surfaceAt(x, y, except) {  // the surface under a window point, other than `except`
    return document.elementsFromPoint(x, y).map((e) => e.closest?.("[data-surface]")).find((b) => b && b !== except) || null;
  }

  function drag(s, id, e) {  // hold: pin; move: drag it; hold still over another surface, then release: combine
    if (e.target.closest("button")) return;
    const handle = e.currentTarget, box = s.box;
    handle.setPointerCapture(e.pointerId);  // keep getting moves over iframes and other surfaces
    let place = null, held = false, x0 = 0, y0 = 0;
    let under = null, armed = null, wait = null, sx = 0, sy = 0;  // the surface under the pointer; armed: lit, ready to combine
    const hold = setTimeout(() => { held = true; page.send({ type: "ui_pin", surface: id, pinned: !s.pinned }); }, HOLD_MS);
    handle.onpointermove = (ev) => {
      if (held || Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      clearTimeout(hold);
      if (s.pinned || s.draggable === false) return;
      if (!place) { pinStacked(); x0 = box.offsetLeft; y0 = box.offsetTop; box.style.zIndex = 4; }  // offsets in the main space; above the rest while dragged
      place = { ...s.place, x: Math.round(x0 + ev.clientX - e.clientX), y: Math.round(y0 + ev.clientY - e.clientY) };
      box.toggleAttribute("data-placed", true);
      Object.assign(box.style, { position: "absolute", margin: "0", left: `${place.x}px`, top: `${place.y}px` });
      const now = surfaceAt(ev.clientX, ev.clientY, box);
      if (now !== under || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {  // moved: start waiting again
        clearTimeout(wait);
        armed?.removeAttribute("data-drop");
        armed = null, under = now, sx = ev.clientX, sy = ev.clientY;
        if (now) wait = setTimeout(() => { armed = now; now.setAttribute("data-drop", ""); }, COMBINE_MS);
      }
    };
    handle.onpointerup = (ev) => {
      clearTimeout(hold);
      clearTimeout(wait);
      handle.onpointermove = handle.onpointerup = null;
      armed?.removeAttribute("data-drop");
      if (!place) return;  // a click or a hold, not a drag
      box.style.zIndex = "";
      if (armed) {  // combine: put this one back, and ask how (point.js); b is the one that changes
        Object.assign(box.style, { left: `${s.place.x}px`, top: `${s.place.y}px` });
        const b = armed.dataset.surface;
        if (surfaces[b]?.pinned) return page.note(`${b} is pinned, so it can't take ${id} in. Hold its label to unpin it first.`);
        document.dispatchEvent(new CustomEvent("ui-combine", { detail: { a: id, b, x: ev.clientX, y: ev.clientY } }));
        return;
      }
      s.place = place;
      page.send({ type: "ui_move", surface: id, place });
    };
  }

  function resize(s, id, e) {  // drag the corner: the surface's new width and height; on release, pin it so
    if (s.pinned) return;
    pinStacked();
    const handle = e.currentTarget, box = s.box;
    const x = box.offsetLeft, y = box.offsetTop, w0 = box.offsetWidth, h0 = box.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    let place = null;
    handle.onpointermove = (ev) => {
      place = { x, y, width: Math.min(area.clientWidth - x, Math.max(40, Math.round(w0 + ev.clientX - e.clientX))),
                height: Math.max(30, Math.round(h0 + ev.clientY - e.clientY)) };
      box.toggleAttribute("data-placed", true);
      Object.assign(box.style, { position: "absolute", margin: "0", left: `${x}px`, top: `${y}px`,
                                 width: `${place.width}px`, height: `${place.height}px` });
    };
    handle.onpointerup = () => {
      handle.onpointermove = handle.onpointerup = null;
      if (!place) return;
      s.place = place;
      page.send({ type: "ui_move", surface: id, place });
    };
  }

  await loadAbouts();
  for (const [id, s] of Object.entries(await (await fetch("/ui-api/surfaces")).json())) surfaces[id] = { ...s, option: 0 };
  for (const id of Object.keys(surfaces)) draw(id);
}
