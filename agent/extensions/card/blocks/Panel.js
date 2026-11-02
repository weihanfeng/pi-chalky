// Panel: a glass panel with an optional title; its children are stacked inside.
export const about = {
  "version": 1,
  "props": {
    "title": {"type": "text", "doc": "optional"}
  },
  "children": "many",
  "levers": ["Titled {title}."],
  "example": {"title": "Lunch orders"}
};
export default class extends HTMLElement {
  update({ title = "" }, card) {
    if (!this.body) {
      this.style.cssText = "display:block;padding:14px 16px;border-radius:var(--radius);background:var(--glass-strong);" +
        "border:1px solid var(--edge);box-shadow:var(--shadow);backdrop-filter:var(--blur)";
      this.innerHTML = `<div style="font-weight:600;margin-bottom:8px"></div><div style="display:flex;flex-direction:column;gap:8px"></div>`;
      this.body = this.lastChild;
    }
    this.firstChild.textContent = title;
    this.firstChild.hidden = !title;
    card.mount(this.body);
  }
}
