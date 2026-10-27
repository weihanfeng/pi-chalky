// Button: a button that sends an action to the agent when clicked.
export const about = {
  "version": 1,
  "props": {
    "label": {"type": "text", "default": "OK"},
    "action": {"type": "action", "default": "click", "doc": "the action name you will receive"},
    "context": {"type": "object", "doc": "sent with the action; values may be {\"path\": ...}"},
    "variant": {"type": "choice", "options": ["primary", "secondary"], "default": "primary"}
  },
  "children": "none",
  "levers": ["Says {label}.", "Looks {variant}."],
  "example": {"label": "Send order", "action": "send", "variant": "primary"}
};
export default class extends HTMLElement {
  update(props, ui) {
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.onclick = () => this.ui.action(this.props.action || "click", this.props.context || {});
      this.append(this.button);
    }
    this.props = props;
    this.ui = ui;
    this.button.textContent = props.label || "OK";
    this.button.style.cssText = "border-radius:980px;padding:7px 16px;font-weight:500;" + (props.variant === "secondary"
      ? "background:var(--glass-strong);color:var(--accent);border:1px solid var(--line)"
      : "background:var(--accent);color:#fff;border:0");
  }
}
