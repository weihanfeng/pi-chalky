// Markdown: formatted text from a markdown string (headings, lists, tables, code, links, quotes).
// HTML in the text is sanitised; links open in a new tab. The chat draws message bodies with it too.
export const about = {
  "version": 1,
  "props": {
    "text": {"type": "text", "doc": "markdown"}
  },
  "children": "none",
  "levers": [],
  "example": {"text": "**Lunch** closes *Friday 11:00*"}
};
import { marked } from "marked";      // bare names: resolved by the import map in chat_ui.html
import DOMPurify from "dompurify";

const CSS = `
ui-markdown { display: block; white-space: normal; }
ui-markdown p, ui-markdown ul, ui-markdown ol, ui-markdown pre, ui-markdown table, ui-markdown blockquote { margin: 6px 0; }
ui-markdown ul, ui-markdown ol { padding-left: 22px; }
ui-markdown h1, ui-markdown h2, ui-markdown h3, ui-markdown h4 { font-size: 1.05em; margin: 8px 0 4px; }
ui-markdown code { font: 12.5px monospace; background: rgba(0, 0, 0, .06); padding: 1px 4px; border-radius: 3px; }
ui-markdown pre { background: var(--hover); padding: 8px; border-radius: 4px; overflow-x: auto; }
ui-markdown pre code { background: none; padding: 0; }
ui-markdown table { border-collapse: collapse; }
ui-markdown th, ui-markdown td { border: 1px solid var(--line); padding: 3px 8px; }
ui-markdown blockquote { border-left: 3px solid var(--line); padding-left: 8px; color: var(--soft); }`;

export default class extends HTMLElement {
  update({ text = "" }) {
    if (!document.getElementById("ui-markdown-css")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="ui-markdown-css">${CSS}</style>`);
    }
    if (this.state?.text === text) return;  // unchanged: keep the DOM (and any selection)
    this.state = { text };
    this.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
    for (const a of this.querySelectorAll("a")) { a.target = "_blank"; a.rel = "noopener"; }
  }
}
