// App: shows a full mini-site from {code}/ui/apps/<name>/ in a frame. For big things (multi-file games, editors)
// that don't fit one component. Put index.html (and its scripts) in {code}/ui/apps/<name>/.
// No frame of its own and a clear background: only the app's page shows (keep that page's background
// transparent unless the app needs one). As wide as its surface; it fills its surface's placed area,
// else it is `height` px tall. The app can talk to the agents and see their messages: /ui/agents.js.
export const about = {
  "version": 1,
  "props": {
    "src": {"type": "text", "doc": "path inside {code}/ui/apps, e.g. \"snake/index.html\""},
    "height": {"type": "number", "default": 400, "doc": "px, when nothing else sizes it"}
  },
  "children": "none",
  "levers": ["Shows {src}.", "{height} px tall when not placed."],
  "example": {"src": "snake/index.html", "height": 400}
};
export default class extends HTMLElement {
  update({ src = "", height = 400 }) {
    if (!this.frame) {
      this.style.cssText = "display:flex;flex-direction:column;align-self:stretch";
      this.frame = document.createElement("iframe");
      this.frame.style.cssText = "width:100%;min-height:0;border:0;background:transparent;color-scheme:normal";
      this.append(this.frame);
    }
    this.frame.style.flex = `1 1 ${height}px`;  // height when nothing sizes it; grows or shrinks to a placed area
    const url = `/ui/apps/${src}`;
    if (this.frame.getAttribute("src") !== url) this.frame.setAttribute("src", url);  // don't restart a running app
  }
}
