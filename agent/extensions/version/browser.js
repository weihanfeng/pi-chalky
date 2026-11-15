// Pictures for the Versions panel, taken by the open page itself (no headless browser): after a new version (the
// "version" event), and when the page opens and the current version has none yet. It draws the main space (#top)
// with dom-to-image-more, then each same-site app frame's own page pasted in place (the library leaves frames
// blank), crops to the cards plus a margin, and uploads it: PUT /version/<sha>/shot (the first page wins).
// Can't be drawn: video, and pictures or frames from other sites (those parts stay blank).
// Also: when Chalky was updated at this start (GET /version/update), a notice says what changed or why it couldn't.
const MARGIN = 32;
let lib;
const library = () => lib ??= new Promise((ok, no) => {  // loaded once, on the first picture
  const s = Object.assign(document.createElement("script"), { src: "/version/dom-to-image-more.js", onload: () => ok(window.domtoimage), onerror: no });
  document.head.append(s);
});
const image = (src) => new Promise((ok, no) => Object.assign(new Image(), { onload() { ok(this); }, onerror: no, src }));

async function picture() {  // a PNG blob of the cards, or null if there are none
  const top = document.getElementById("top"), cards = [...top.querySelectorAll("[data-card]")];
  if (!cards.length) return null;
  const domtoimage = await library(), at = top.getBoundingClientRect(), z = parseFloat(top.style.zoom) || 1;  // the board's zoom: drawn at 100%
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - at.left) / z + top.scrollLeft, y: (r.top - at.top) / z + top.scrollTop, w: r.width / z, h: r.height / z }; };
  const all = cards.map(box);
  const x0 = Math.max(0, Math.min(...all.map((b) => b.x)) - MARGIN), y0 = Math.max(0, Math.min(...all.map((b) => b.y)) - MARGIN);
  const x1 = Math.max(...all.map((b) => b.x + b.w)) + MARGIN, y1 = Math.max(...all.map((b) => b.y + b.h)) + MARGIN;
  const width = Math.ceil(x1), height = Math.ceil(y1);  // the whole main space up to the last card; cropped below
  const bgcolor = getComputedStyle(document.body).backgroundColor;
  const page = await image(await domtoimage.toPng(top, { width, height, bgcolor,
    style: { position: "static", inset: "auto", overflow: "visible", width: `${width}px`, height: `${height}px`, zoom: "1" } }));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) });
  const g = canvas.getContext("2d");
  g.drawImage(page, -x0, -y0);
  for (const frame of top.querySelectorAll("iframe")) {  // apps: their own pages, drawn and pasted where they are
    let doc;
    try { doc = frame.contentDocument; } catch { continue; }  // another site's frame: stays blank
    if (!doc?.documentElement) continue;
    const b = box(frame);
    if (!b.w || !b.h) continue;
    try {
      const app = await image(await domtoimage.toPng(doc.documentElement, { width: b.w, height: b.h, bgcolor: "#fff" }));
      g.drawImage(app, b.x - x0, b.y - y0, b.w, b.h);
    } catch {}  // this app can't be drawn: the rest of the picture still is
  }
  return new Promise((ok) => canvas.toBlob(ok, "image/png"));
}

let busy = Promise.resolve();
function shoot(sha) {  // one picture at a time
  busy = busy.then(async () => {
    const png = await picture();
    if (png) await fetch(`/version/${sha}/shot`, { method: "PUT", body: png });
  }).catch((e) => console.warn("versions: no picture", e));
}

export default async function (page) {
  if (new URLSearchParams(location.search).has("shot")) return;  // the old headless view
  page.on("version", (ev) => setTimeout(() => shoot(ev.sha), 2000));  // after the page has redrawn what changed
  fetch("/version/update").then((r) => r.json()).then((u) => {
    if (!u) return;
    const kept = u.conflicts?.length;
    page.notice(u.error ? [`Chalky couldn't update to ${u.release}, so it runs as before. ${u.error}`]
      : [`Updated to ${u.release}: ${u.files} file${u.files === 1 ? "" : "s"} changed.`
        + (kept ? ` ${kept} kept your change; agent1 is merging the update into ${kept === 1 ? "it" : "them"}.` : "")
        + " To undo it, go back a version in Versions."]);
  }).catch(() => {});
  try {  // the current version has no picture yet (made while no page was open): take it now
    const current = (await (await fetch("/version")).json()).find((v) => v.current);
    if (current && !current.shot) setTimeout(() => shoot(current.short), 3000);  // once the cards are drawn
  } catch {}
}
