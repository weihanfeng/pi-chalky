// The page side of the screen extension: this tab, shared once (getDisplayMedia), for every extension that needs a picture
// of what the user sees. Offered as page.provide("screen", {...}); an extension gets it with await page.use("screen"):
//   share()            ask the browser to share this tab (only works right after a click: transient activation);
//                      resolves true if shared. The user can stop sharing any time (the browser's bar).
//   shared()           whether the tab is shared now
//   frame()            the screen right now, as a canvas (null when not shared)
//   picture(full, box) crop a frame to box (window px {x, y, w, h}), upload it (POST /screen/shot): {path, url}
// An agent can ask to see the screen (its tool screen_see, event screen_ask): if the tab is shared, a picture
// of the whole window goes back at once; else a notice asks "Share" (✕: no) first, since the agent's ask is no click
// (screen_reply {id, shot, window, main}).
export default async function (page) {
  const area = page.slot("top");

  let stream = null, video = null;
  async function share() {
    if (stream) return true;
    try {
      const full = { width: { ideal: innerWidth * devicePixelRatio }, height: { ideal: innerHeight * devicePixelRatio } };  // sharp: the page's own pixels
      stream = await navigator.mediaDevices.getDisplayMedia({ video: full, preferCurrentTab: true, selfBrowserSurface: "include" });
      stream.getVideoTracks()[0].onended = () => { stream = null; video?.remove(); video = null; };  // the user stopped sharing
      video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, srcObject: stream });
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.append(video);
      await video.play();
      return true;
    } catch { stream = null; return false; }  // not shared
  }
  const shared = () => !!video?.videoWidth;
  function frame() {
    if (!shared()) return null;
    const c = Object.assign(document.createElement("canvas"), { width: video.videoWidth, height: video.videoHeight });
    c.getContext("2d").drawImage(video, 0, 0);
    return c;
  }
  async function picture(full, box) {
    const kx = full.width / innerWidth, ky = full.height / innerHeight;  // frame px per window px (the frame is the tab)
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(box.w * kx), height: Math.round(box.h * ky) });
    c.getContext("2d").drawImage(full, box.x * kx, box.y * ky, box.w * kx, box.h * ky, 0, 0, c.width, c.height);
    const png = await new Promise((ok) => c.toBlob(ok, "image/png"));
    const out = await (await fetch("/screen/shot", { method: "POST", body: png })).json();
    return { path: out.path || null, url: URL.createObjectURL(png) };
  }
  page.provide("screen", { share, shared, frame, picture });

  // ---- an agent asks to see the screen ----
  const asks = {};  // id -> its card, while the agent waits
  async function answer(id) {
    for (const card of Object.values(asks)) card.close();   // not in the picture
    await new Promise((ok) => setTimeout(ok, 400));         // it has slid away; a fresh frame from the shared tab
    const full = frame();
    const s = full && await picture(full, { x: 0, y: 0, w: innerWidth, h: innerHeight }).catch(() => null);
    const m = area.getBoundingClientRect();  // window (0, 0) in main-space px (as note/browser.js)
    page.send({ type: "screen_reply", id, shot: s?.path || null, window: { width: innerWidth, height: innerHeight },
                main: { x: area.scrollLeft - m.left, y: area.scrollTop - m.top } });
  }
  page.on("screen_ask", ({ id, agent }) => {
    if (shared()) return answer(id);
    const yes = Object.assign(document.createElement("button"), { className: "go", textContent: "Share" });
    yes.onclick = async () => { await share(); answer(id); };
    asks[id] = page.notice([`${agent} wants to see your screen`, yes], () => page.send({ type: "screen_reply", id, shot: null }));  // ✕: no
  });
  page.on("screen_ask_done", ({ id }) => { asks[id]?.close(); delete asks[id]; });  // answered (here or in another tab), or timed out
}
