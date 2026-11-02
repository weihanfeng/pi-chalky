// TextField: a labelled text input. Bind value to data so the agent gets what the user typed.
export const about = {
  "version": 1,
  "props": {
    "label": {"type": "text"},
    "value": {"type": "text", "doc": "usually {\"path\": \"/name\"}, so you get what the user typed"},
    "placeholder": {"type": "text"},
    "multiline": {"type": "boolean", "default": false}
  },
  "children": "none",
  "levers": ["Labelled {label}.", "Hint: {placeholder}.", "Several lines: {multiline}."],
  "example": {"label": "Your name", "value": "", "placeholder": "e.g. S. Tan"}
};
export default class extends HTMLElement {
  update({ label = "", value = "", placeholder = "", multiline = false }, card) {
    if (!this.input) {
      this.style.cssText = "display:flex;flex-direction:column;gap:4px";
      this.innerHTML = `<label style="font-size:12px;color:var(--muted)"></label>`;
      this.input = document.createElement(multiline ? "textarea" : "input");
      this.input.style.cssText = "padding:8px 10px;font:inherit;color:inherit;border-radius:10px;" +
        "background:var(--glass-strong);border:1px solid var(--line)";
      this.input.oninput = () => this.card.set("value", this.input.value);
      this.append(this.input);
    }
    this.card = card;
    this.firstChild.textContent = label;
    this.input.placeholder = placeholder;
    if (document.activeElement !== this.input) this.input.value = value ?? "";  // don't fight the user's typing
  }
}
