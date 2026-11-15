// The page side of cards (index.ts here: the record, the tools, the messages). Draws the cards of the main space (the
// "top" slot): each shows its blocks, or its app (built/apps/..., served at /built/...) in a frame.
// A card is bare: only what the agent built, no frame (its label shows on hover: name, owner, ✕). It is
// stacked in the main space, its content keeping its own size; or pinned at place {x, y, width?, height?}
// (px from the main space's top-left, so it scrolls with the page), its root block then filling it.
// (a new card with no place gets one near the middle of the view: autoPlace)
// What the user can do with the label (the handle, so clicks inside still work):
//   drag          move it; a drop sends {type: "card_move", card, place} (unless draggable: false)
//   drag and hold still over another card (it lights up), release   combine: it slides back and the page
//                 fires a "card-combine" DOM event. A plain drop over another card just moves it (they overlap)
//                 {a, b, x, y} (note/browser.js opens a note box; the agent then changes b, and a stays).
//                 Onto a pinned card: refused (it would change), with a note in the chat
//   hold          pin or unpin it ({type: "card_pin"}): agents can't change a pinned card, and it stays put
//   double-click  turn it over: the back side shows what it is for (about), what it was made from, and
//                 each block's levers (sentences from its about block; the words in them change it)
//   ✕             close it; if other cards read from it, the label asks first (they get a copy)
// The corner resizes it (unless resizable: false). Moving or resizing one first pins every stacked card
// where it is (else the ones below would jump up).
// Typing into a bound field changes the data at once and sends {type: "card_set"} shortly after: saved, and
// no agent is woken; so does a click on a Button with set (card.write). A block with
// when: {"path", "is"} is hidden while that data is something else (tabs, steps, "show more"). Props can read other cards' data ({"ref", "path"}); those redraw when it changes.
// Alternatives (options): drawn as a stack with a bar to flip through them; "Keep" sends {type: "card_keep"}.
// Blocks come from the page's catalog (page.load defines <block-name>; see page.html); one saved with
// an older version of its props goes through the block's upgrade(props, fromVersion) first.
// Elements are kept per id across redraws, so a block keeps its state (focus, a running game).
const get = (data, path) => path.split("/").filter(Boolean).reduce((o, k) => o?.[k], data);
const isBinding = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).join() === "path";
const isRef = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "path,ref";
const propsOf = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !["id", "block", "children", "child", "when"].includes(k)));
const refsIn = (s) => new Set((s.blocks ?? []).flatMap((c) => Object.values(propsOf(c)).filter(isRef).map((v) => v.ref)));
const HOLD_MS = 550;  // hold the label this long, without moving, to pin or unpin
const COMBINE_MS = 600;  // hold a dragged card still over another this long to combine with it

const CSS = `
  [data-card] { position: relative; display: flex; flex-direction: column; width: fit-content; max-width: 100%; margin: 0 0 20px; }
  [data-card] > .card-body { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; }
  [data-card] > .card-body > * { max-width: 100%; }
  [data-card] > .card-body [hidden] { display: none !important; }
  [data-card][data-placed] > .card-body { align-items: stretch; }
  [data-card][data-placed] > .card-body > * { flex: 1; min-height: 0; }
  [data-card] > .card-label { position: absolute; bottom: 100%; left: 0; z-index: 2; display: flex; gap: 8px; align-items: center;
    padding: 2px 8px; border-radius: 8px; font-size: 11px; white-space: nowrap; color: var(--muted, #888); cursor: grab;
    background: var(--glass-strong, #fff); opacity: 0; pointer-events: none; transition: opacity 0.15s; user-select: none; }
  [data-card]:hover > .card-label, [data-card] > .card-label.asking { opacity: 1; pointer-events: auto; }
  [data-card] > .card-label button { color: inherit; font: inherit; background: none; border: 0; cursor: pointer; padding: 0 2px; }
  [data-card] > .card-label .ask { color: var(--ink, #1d1d1f); }
  [data-card] > .card-resize { position: absolute; right: 0; bottom: 0; z-index: 1; width: 10px; height: 10px;
    border: solid var(--muted, #888); border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; cursor: nwse-resize;
    opacity: 0; pointer-events: none; transition: opacity 0.15s; }
  [data-card]:hover > .card-resize { opacity: 1; pointer-events: auto; }
  [data-card][data-pinned] { outline: 2px solid #d4691e; outline-offset: 4px; border-radius: 6px; }
  [data-card][data-pinned] > .card-label { cursor: default; }
  [data-card][data-pinned] > .card-resize { display: none; }
  [data-card][data-drop] { outline: 3px solid var(--accent, #0071e3); outline-offset: 4px; border-radius: 6px; }
  [data-card][data-flipped] { z-index: 5; }  /* the back side stays above its neighbours */
  [data-card][data-flipped] > .card-body { visibility: hidden; }
  [data-card] > .card-back { position: absolute; left: 0; top: 0; z-index: 1; box-sizing: border-box; min-width: 260px; min-height: 100%;
    max-width: 420px; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; color: #e8eeea; background: #1f2a25;
    box-shadow: 0 8px 30px rgba(0,0,0,.18); display: flex; flex-direction: column; gap: 8px; }
  [data-card] > .card-back p { margin: 0; }
  [data-card] > .card-back ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  [data-card] > .card-back .lever { font: inherit; color: #1f2a25; background: #f4d35e; border: 0; border-radius: 4px;
    padding: 0 5px; cursor: pointer; outline-offset: 1px; }
  [data-card] > .card-back span.lever { cursor: text; }
  [data-card] > .card-back .lever.ref { background: #c7d3cd; cursor: default; }
  [data-card] > .card-back .muted { opacity: .7; }
  [data-card] > .card-back > button { align-self: flex-start; font: inherit; color: inherit; background: none;
    border: 1px solid currentColor; border-radius: 8px; padding: 3px 10px; cursor: pointer; }
  [data-card][data-options] > .card-body { box-shadow: 8px 8px 0 -2px rgba(0,0,0,.07), 16px 16px 0 -4px rgba(0,0,0,.05); border-radius: 10px; }
  [data-card] > .card-options { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; font-size: 12px; color: var(--muted, #888); }
  [data-card] > .card-options button { font: inherit; color: inherit; background: var(--glass-strong, #fff);
    border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 1px 8px; cursor: pointer; }
  [data-card] > .card-options button.keep { color: #fff; background: var(--accent, #0071e3); border-color: transparent; }`;

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
  if (!page.load) return;  // an older page (e.g. a Versions preview) without the block runtime
  document.head.insertAdjacentHTML("beforeend", `<style id="card-css">${CSS}</style>`);
  const area = page.slot("top");
  const cards = {};  // id -> the record (index.ts), plus what only this page has: box, body, nodes, frame, flipped, option
  let abouts = {}, mtimes = {};
  const modules = {};   // block name -> its module (for upgrade())
  const loadAbouts = async () => {
    try { [abouts, mtimes] = await Promise.all(["/card/about", "/card/blocks"].map(async (u) => (await fetch(u)).json())); } catch {}
  };
  page.on("version", loadAbouts);  // an agent may have changed a block
  const pending = {};   // "card path" -> timer: card_set waits until the typing pauses
  const sendSet = (id, path, value) => {
    clearTimeout(pending[`${id} ${path}`]);
    pending[`${id} ${path}`] = setTimeout(() => page.send({ type: "card_set", card: id, path, value }), 500);
  };

  async function upgraded(name, props, s) {  // props saved with an older about.version: through upgrade() first
    const from = s.kinds?.[name], now = abouts[name]?.version;
    if (!from || !now || from >= now) return props;
    try {
      const mod = await (modules[name] ??= import(`/card/blocks/${name}.js?v=${mtimes[name]}`));
      return mod.upgrade ? mod.upgrade(props, from) : props;
    } catch (e) { console.warn(`upgrade of ${name}:`, e); return props; }
  }

  async function draw(id, chain = new Set()) {
    const s = cards[id];
    if (!s || chain.has(id)) return;  // chain: cards reading from each other are drawn once each
    chain.add(id);
    if (!s.box) {  // the card, with a label (name, pin, ✕) that shows on hover
      s.box = el("div");
      s.box.dataset.card = id;  // lets the page work out what a click points at (note/browser.js)
      s.label = el("div", { class: "card-label" });
      s.body = el("div", { class: "card-body" });
      s.box.append(s.label, s.body, el("div", { class: "card-resize", title: "Drag to resize", onpointerdown: (e) => resize(s, id, e) }));
      s.label.onpointerdown = (e) => drag(s, id, e);
      s.label.ondblclick = () => { s.flipped = !s.flipped; draw(id); };
      s.nodes = {};
      area.append(s.box);
    }
    drawLabel(s, id);
    s.box.dataset.owner = s.owner;  // who a note on this card goes to (note/browser.js)
    s.box.dataset.board = s.board ?? 1;  // its board: board/browser.js shows it there
    s.box.querySelector(".card-resize").hidden = s.resizable === false;
    s.box.toggleAttribute("data-pinned", !!s.pinned);
    s.box.toggleAttribute("data-flipped", !!s.flipped);
    s.box.toggleAttribute("data-options", !!s.options);
    const p = s.place;
    s.box.toggleAttribute("data-placed", !!p);
    Object.assign(s.box.style, p ? { position: "absolute", left: `${p.x}px`, top: `${p.y}px`, margin: "0",
                                     width: p.width ? `${p.width}px` : "", height: p.height ? `${p.height}px` : "" }
                                 : { position: "", left: "", top: "", margin: "", width: "", height: "" });
    drawOptionsBar(s, id);
    const shown = s.options ? s.options[s.option ?? 0] : s;  // an alternative, or the card itself
    if (shown.app) return drawApp(s, id, shown);
    s.frame = null;
    try {
      for (const c of shown.blocks) if (!(await page.load(c.block))) throw new Error(`no block ${c.block}`);
    } catch (e) {
      s.body.textContent = `Could not load a block: ${e}`;
      return;
    }
    const byId = Object.fromEntries(shown.blocks.map((c) => [c.id, c]));
    const resolve = (v) => (isBinding(v) ? get(shown.data, v.path) : isRef(v) ? get(cards[v.ref]?.data ?? {}, v.path) : v);
    const props = {};
    for (const c of shown.blocks) props[c.id] = await upgraded(c.block, Object.fromEntries(
      Object.entries(propsOf(c)).map(([k, v]) => [k, resolve(v)])), s);

    const build = (cid) => {
      const c = byId[cid], tag = `block-${c.block.toLowerCase()}`;
      const node = s.nodes[cid]?.localName === tag ? s.nodes[cid] : document.createElement(tag);
      s.nodes[cid] = node;
      node.dataset.block = cid;
      const children = (c.children || (c.child ? [c.child] : [])).map(build);
      node.update(props[cid], {
        children,
        mount(container) {  // only re-insert children when they changed (moving a node loses its focus)
          if (container.children.length !== children.length || children.some((ch, i) => container.children[i] !== ch))
            container.replaceChildren(...children);
        },
        set(prop, value) {  // write a bound prop into the data: at once here, saved shortly after (card_set)
          if (!isBinding(c[prop])) return;  // a plain value or another card's data: not this field's to write
          setPath(shown.data, c[prop].path, value);
          if (!s.options) sendSet(id, c[prop].path, value);
          draw(id);
        },
        data: shown.data,  // this card's data, to read (write through set or write)
        write(values) {  // {path: value, ...} into this card's data: at once here, saved shortly after (card_set)
          for (const [path, value] of Object.entries(values)) {
            setPath(shown.data, path, value);
            if (!s.options) sendSet(id, path, value);
          }
          draw(id);
        },
        action(name, context = {}) {
          const ctx = Object.fromEntries(Object.entries(context).map(([k, v]) => [k, resolve(v)]));
          page.send({ type: "card_action", card: id, block: cid, name, context: ctx, data: s.data });
        },
      });
      node.hidden = !!c.when && get(shown.data, c.when.path) !== c.when.is;  // shown only while its data matches
      return node;
    };
    try {
      const root = build("root");
      if (s.body.firstChild !== root) s.body.replaceChildren(root);
    } catch (e) {
      s.body.textContent = `Could not draw this card: ${e}`;
    }
    drawBack(s, id, shown, resolve);
    for (const [other, o] of Object.entries(cards)) if (o.blocks && refsIn(o).has(id)) draw(other, chain);
  }

  function drawApp(s, id, shown) {  // an app: its page in a frame, 640px wide (at most the space there); it fills a
    if (!s.frame) {                  // placed card, else it is height px tall. The same frame across redraws: a running app isn't restarted
      s.frame = el("iframe");
      s.frame.style.cssText = "display:block;width:100%;min-height:0;border:0;background:transparent;color-scheme:normal";
    }
    s.frame.style.flex = `1 1 ${s.height ?? 400}px`;
    s.frame.style.width = s.place?.width ? "100%" : "640px";  // a frame has no width of its own (else 300px)
    if (s.body.firstChild !== s.frame) s.body.replaceChildren(s.frame);
    const url = `/built/${shown.app}`;
    if (s.frame.getAttribute("src") !== url) s.frame.setAttribute("src", url);
    drawBack(s, id, shown, (v) => v);
  }

  function drawLabel(s, id) {  // name · owner, pinned or not, ✕ (which asks first if others read from it)
    const users = Object.keys(cards).filter((o) => o !== id && cards[o].blocks && refsIn(cards[o]).has(id));
    s.label.classList.remove("asking");
    s.label.replaceChildren(
      el("span", { text: `${id} · ${s.owner}${s.pinned ? " · pinned" : ""}`, title: "Drag to move; hold still over another to combine; hold to pin; double-click to turn over" }),
      el("button", { text: "✕", title: "Close", onclick: () => {
        if (!users.length) return page.send({ type: "card_close", card: id });
        s.label.classList.add("asking");
        s.label.replaceChildren(
          el("span", { class: "ask", text: `${users.join(", ")} ${users.length > 1 ? "read" : "reads"} from this. Copy it in, then close?` }),
          el("button", { text: "Copy & close", onclick: () => page.send({ type: "card_close", card: id }) }),
          el("button", { text: "Cancel", onclick: () => drawLabel(s, id) }));
      } }));
  }

  function drawOptionsBar(s, id) {
    s.box.querySelector(".card-options")?.remove();
    if (!s.options) return;
    const i = s.option ?? 0, n = s.options.length;
    const flip = (d) => { s.option = (i + d + n) % n; draw(id); };
    const bar = el("div", { class: "card-options" },
      el("button", { text: "‹", title: "Previous", "aria-label": "Previous option", onclick: () => flip(-1) }),
      el("span", { text: `${i + 1} of ${n}: ${s.options[i].label}` }),
      el("button", { text: "›", title: "Next", "aria-label": "Next option", onclick: () => flip(1) }),
      el("button", { class: "keep", text: "Keep this", onclick: () => page.send({ type: "card_keep", card: id, index: i }) }));
    bar.onwheel = (e) => { e.preventDefault(); flip(Math.sign(e.deltaY || e.deltaX)); };
    s.box.insertBefore(bar, s.body);
  }

  function drawBack(s, id, shown, resolve) {  // the back side: about, made from, levers, pinned
    s.box.querySelector(".card-back")?.remove();
    if (!s.flipped) return;
    const back = el("div", { class: "card-back" }, el("b", { text: `How ${id} works` }),
      el("p", { class: s.about ? "" : "muted", text: s.about || "No description yet. Ask its agent to write one." }));
    if (s.made_from) back.append(el("p", { text: `Made from ${s.made_from.join(" and ")}` + (s.instruction ? `: “${s.instruction}”` : ".") }));
    const list = el("ul");
    for (const c of shown.blocks ?? []) {
      const spec = abouts[c.block];
      for (const sentence of spec?.levers || []) {
        const li = el("li", {}, el("span", { class: "muted", text: `${c.id}: ` }));
        for (const [i, part] of sentence.split(/\{(\w+)\}/).entries()) li.append(i % 2 ? lever(s, id, shown, c, part, spec.props?.[part] || {}, resolve) : part);
        list.append(li);
      }
    }
    if (list.children.length) back.append(list);
    back.append(el("p", {}, "It is ", el("button", { class: "lever", text: s.pinned ? "pinned" : "not pinned",
      onclick: () => page.send({ type: "card_pin", card: id, pinned: !s.pinned }) }),
      `: agents ${s.pinned ? "can't" : "may"} change it.`));
    back.append(el("button", { text: "Turn back", onclick: () => { s.flipped = false; draw(id); } }));
    s.box.append(back);
  }

  function lever(s, id, shown, c, prop, spec, resolve) {  // one {prop} of a lever sentence: a control
    const raw = c[prop], value = resolve(raw) ?? spec.default ?? "";
    if (isRef(raw)) return el("span", { class: "lever ref", text: String(value), title: `read from ${raw.ref}` });
    const commit = (v) => {
      if (isBinding(raw)) { setPath(shown.data, raw.path, v); page.send({ type: "card_set", card: id, path: raw.path, value: v }); }
      else { c[prop] = v; page.send({ type: "card_prop", card: id, block: c.id, prop, value: v }); }
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

  page.on("card", (ev) => {
    if (ev.op === "render") {
      const isNew = !cards[ev.card], old = cards[ev.card] || {};
      const { op, type, card, ...record } = ev;
      cards[ev.card] = { ...record, box: old.box, label: old.label, body: old.body, nodes: old.nodes, frame: old.frame,
                               flipped: old.flipped, option: record.options ? old.option : 0 };
      draw(ev.card).then(() => { if (isNew && !record.place) autoPlace(ev.card); });
    } else if (ev.op === "delete" && cards[ev.card]) {
      cards[ev.card].box?.remove();
      delete cards[ev.card];
      for (const id of Object.keys(cards)) drawLabel(cards[id], id);
    } else if (ev.op === "reset") {  // a whole saved state (undo, redo, rewind)
      for (const id of Object.keys(cards)) if (!(id in ev.cards)) { cards[id].box?.remove(); delete cards[id]; }
      for (const [id, record] of Object.entries(ev.cards)) {
        const old = cards[id] || {};
        cards[id] = { ...record, box: old.box, label: old.label, body: old.body, nodes: old.nodes, frame: old.frame, flipped: old.flipped, option: 0 };
      }
      for (const id of Object.keys(cards)) draw(id);
    }
  });

  // A new card the agent gave no place: near the middle of what the user sees (between the panel, if open, and the
  // right edge; below the palette, above the input bar), clear of everything else on the board. The nearest free
  // spot to the middle, on a 40 px grid, keeping a 24 px gap. Only the tab in view, and only on the board shown
  // (a card for another board stays stacked). Sent as card_place: saved, with no step of its own in the history.
  const GAP = 24, STEP = 40, RINGS = 60;
  async function autoPlace(id) {
    const s = cards[id];
    if (!s?.box || s.place || document.visibilityState !== "visible") return;
    if ((Number(s.board) || 1) !== (Number(document.body.dataset.board) || 1)) return;
    await new Promise(requestAnimationFrame);  // its blocks drawn
    if (s.place) return;
    const box = s.box;
    box.toggleAttribute("data-placed", true);  // its size as a placed card, off the stack
    Object.assign(box.style, { position: "absolute", margin: "0", left: "0px", top: "0px", visibility: "hidden" });
    const z = parseFloat(area.style.zoom) || 1, w = box.offsetWidth, h = box.offsetHeight;
    const m = area.getBoundingClientRect();
    const main = (x, y) => ({ x: (x - m.left) / z + area.scrollLeft, y: (y - m.top) / z + area.scrollTop });
    const css = getComputedStyle(document.documentElement), px = (v) => parseFloat(css.getPropertyValue(v)) || 0;
    const panel = document.getElementById("panel"), open = ["messages", "versions"].includes(document.body.dataset.panel);
    const side = px("--rail") + 28;
    const a = main(Math.max(side, open && panel ? panel.getBoundingClientRect().right : 0), px("--palette"));
    const b = main(innerWidth - side, innerHeight - px("--bar"));
    const cx = (a.x + b.x) / 2 - w / 2, cy = (a.y + b.y) / 2 - h / 2;
    const others = [...(box.parentElement?.children ?? [])].filter((el) => el !== box).map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height).map((r) => ({ ...main(r.left, r.top), w: r.width / z, h: r.height / z }));
    const free = (x, y) => others.every((o) => x + w + GAP <= o.x || o.x + o.w + GAP <= x || y + h + GAP <= o.y || o.y + o.h + GAP <= y);
    const spots = [];
    for (let i = -RINGS; i <= RINGS; i++) for (let j = -RINGS; j <= RINGS; j++) {
      const x = Math.round(cx + i * STEP), y = Math.round(cy + j * STEP);
      if (x >= 0 && y >= 0) spots.push({ x, y, d: (i * i + j * j) });
    }
    spots.sort((p, q) => p.d - q.d);
    const spot = spots.find((p) => free(p.x, p.y)) ?? { x: Math.max(0, Math.round(cx)), y: Math.max(0, Math.round(cy)) };
    // an app keeps its width: a placed box with none shrinks to the room left of the window's edge, and in a narrower
    // window (the card_show check's browser) an app far right would be 0px wide
    s.place = s.app ? { x: spot.x, y: spot.y, width: w } : { x: spot.x, y: spot.y };
    Object.assign(box.style, { left: `${spot.x}px`, top: `${spot.y}px`, visibility: "" });
    if (s.app) { box.style.width = `${w}px`; s.frame && (s.frame.style.width = "100%"); }
    page.send({ type: "card_place", card: id, place: s.place });
  }

  function pinStacked() {  // pin each stacked card where it is now, so taking one out of the stack moves none
    const stacked = Object.entries(cards).filter(([, s]) => !s.place && s.box);
    for (const [, s] of stacked) s.place = { x: s.box.offsetLeft, y: s.box.offsetTop };  // read all, then move
    for (const [id, s] of stacked) {
      s.box.toggleAttribute("data-placed", true);
      Object.assign(s.box.style, { position: "absolute", margin: "0", left: `${s.place.x}px`, top: `${s.place.y}px` });
      page.send({ type: "card_move", card: id, place: s.place });
    }
  }

  function cardAt(x, y, except) {  // the card under a window point, other than `except`
    return document.elementsFromPoint(x, y).map((e) => e.closest?.("[data-card]")).find((b) => b && b !== except) || null;
  }

  function drag(s, id, e) {  // hold: pin; move: drag it; hold still over another card, then release: combine
    if (e.target.closest("button")) return;
    const handle = e.currentTarget, box = s.box;
    handle.setPointerCapture(e.pointerId);  // keep getting moves over iframes and other cards
    let place = null, held = false, x0 = 0, y0 = 0;
    const z = parseFloat(area.style.zoom) || 1;  // the board's zoom (board/browser.js): window px moved -> main px
    let under = null, armed = null, wait = null, sx = 0, sy = 0;  // the card under the pointer; armed: lit, ready to combine
    const hold = setTimeout(() => { held = true; page.send({ type: "card_pin", card: id, pinned: !s.pinned }); }, HOLD_MS);
    handle.onpointermove = (ev) => {
      if (held || Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      clearTimeout(hold);
      if (s.pinned || s.draggable === false) return;
      if (!place) { pinStacked(); x0 = box.offsetLeft; y0 = box.offsetTop; box.style.zIndex = 4; }  // offsets in the main space; above the rest while dragged
      place = { ...s.place, x: Math.round(x0 + (ev.clientX - e.clientX) / z), y: Math.round(y0 + (ev.clientY - e.clientY) / z) };
      box.toggleAttribute("data-placed", true);
      Object.assign(box.style, { position: "absolute", margin: "0", left: `${place.x}px`, top: `${place.y}px` });
      const now = cardAt(ev.clientX, ev.clientY, box);
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
      if (armed) {  // combine: put this one back, and ask how (note/browser.js); b is the one that changes
        Object.assign(box.style, { left: `${s.place.x}px`, top: `${s.place.y}px` });
        const b = armed.dataset.card;
        if (cards[b]?.pinned) return page.note(`${b} is pinned, so it can't take ${id} in. Hold its label to unpin it first.`);
        document.dispatchEvent(new CustomEvent("card-combine", { detail: { a: id, b, x: ev.clientX, y: ev.clientY } }));
        return;
      }
      s.place = place;
      page.send({ type: "card_move", card: id, place });
    };
  }

  function resize(s, id, e) {  // drag the corner: the card's new width and height; on release, pin it so
    if (s.pinned) return;
    pinStacked();
    const handle = e.currentTarget, box = s.box;
    const x = box.offsetLeft, y = box.offsetTop, w0 = box.offsetWidth, h0 = box.offsetHeight, z = parseFloat(area.style.zoom) || 1;
    handle.setPointerCapture(e.pointerId);
    let place = null;
    handle.onpointermove = (ev) => {
      place = { x, y, width: Math.min(area.clientWidth - x, Math.max(40, Math.round(w0 + (ev.clientX - e.clientX) / z))),
                height: Math.max(30, Math.round(h0 + (ev.clientY - e.clientY) / z)) };
      box.toggleAttribute("data-placed", true);
      Object.assign(box.style, { position: "absolute", margin: "0", left: `${x}px`, top: `${y}px`,
                                 width: `${place.width}px`, height: `${place.height}px` });
    };
    handle.onpointerup = () => {
      handle.onpointermove = handle.onpointerup = null;
      if (!place) return;
      s.place = place;
      page.send({ type: "card_move", card: id, place });
    };
  }

  await loadAbouts();
  for (const [id, s] of Object.entries(await (await fetch("/card/all")).json())) cards[id] = { ...s, option: 0 };
  for (const id of Object.keys(cards)) draw(id);
}
