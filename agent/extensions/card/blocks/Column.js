// Column: stacks its children top to bottom.
export const about = {
  "version": 1,
  "props": {
    "gap": {"type": "number", "default": 8, "doc": "px between children"},
    "align": {"type": "choice", "options": ["start", "center", "end", "stretch"], "default": "stretch"}
  },
  "children": "many",
  "levers": ["Children {gap} px apart, aligned {align}."],
  "example": {"gap": 8}
};
export default class extends HTMLElement {
  update({ gap = 8, align = "stretch" }, card) {
    this.style.cssText = `display:flex;flex-direction:column;gap:${gap}px;align-items:${align}`;
    card.mount(this);
  }
}
