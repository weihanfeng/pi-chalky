// Button: a click writes {set} into the surface's data, on the page (no agent is woken). It looks primary
// while the data already holds those values, so a row of them works as tabs.
export const about = {
  "version": 2,
  "props": {
    "label": {"type": "text", "default": "OK"},
    "set": {"type": "object", "doc": "{path: value, ...} written into this surface's data on click, e.g. {\"/tab\": \"training\"}"},
    "variant": {"type": "choice", "options": ["primary", "secondary"], "default": "primary", "doc": "its look when not selected"}
  },
  "children": "none",
  "levers": ["Says {label}.", "Sets {set}.", "Looks {variant}."],
  "example": {"label": "Training", "set": {"/tab": "training"}, "variant": "secondary"}
};
export function upgrade(props, from) {  // version 1 sent an action to the agent instead
  const { action, context, ...rest } = props;
  return rest;
}
const get = (data, path) => path.split("/").filter(Boolean).reduce((o, k) => o?.[k], data);
export default class extends HTMLElement {
  update(props, ui) {
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.onclick = () => this.props.set && this.ui.write(this.props.set);
      this.append(this.button);
    }
    this.props = props;
    this.ui = ui;
    const selected = props.set && Object.entries(props.set).every(([p, v]) => get(ui.data, p) === v);
    this.button.textContent = props.label || "OK";
    this.button.style.cssText = "border-radius:980px;padding:7px 16px;font-weight:500;" + (!selected && props.variant === "secondary"
      ? "background:var(--glass-strong);color:var(--accent);border:1px solid var(--line)"
      : "background:var(--accent);color:#fff;border:0");
  }
}
