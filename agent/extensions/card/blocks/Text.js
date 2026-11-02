// Text: a block of text.
export const about = {
  "version": 1,
  "props": {
    "text": {"type": "text", "doc": "the words"},
    "variant": {"type": "choice", "options": ["h1", "h2", "body", "caption"], "default": "body"}
  },
  "children": "none",
  "levers": ["Shown as {variant}."],
  "example": {"text": "Lunch closes Friday 11:00", "variant": "body"}
};
const STYLE = { h1: "font-size:22px;font-weight:600;letter-spacing:-0.02em", h2: "font-size:17px;font-weight:600", body: "", caption: "font-size:12px;color:var(--muted)" };

export default class extends HTMLElement {
  update({ text = "", variant = "body" }) {
    this.style.cssText = "display:block;white-space:pre-wrap;" + (STYLE[variant] || "");
    this.textContent = text;
  }
}
