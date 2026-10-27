// Row: places its children side by side (wraps when out of space).
export const about = {
  "version": 1,
  "props": {
    "gap": {"type": "number", "default": 8, "doc": "px between children"},
    "align": {"type": "choice", "options": ["start", "center", "end", "stretch"], "default": "center"}
  },
  "children": "many",
  "levers": ["Children {gap} px apart, aligned {align}."],
  "example": {"gap": 8}
};
export default class extends HTMLElement {
  update({ gap = 8, align = "center" }, ui) {
    this.style.cssText = `display:flex;flex-wrap:wrap;gap:${gap}px;align-items:${align}`;
    ui.mount(this);
  }
}
