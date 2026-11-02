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
import { marked } from "marked";      // bare names: resolved by the import map in page.html
import DOMPurify from "dompurify";

const CSS = `
block-markdown { display: block; white-space: normal; }
block-markdown p, block-markdown ul, block-markdown ol, block-markdown pre, block-markdown table, block-markdown blockquote { margin: 6px 0; }
block-markdown ul, block-markdown ol { padding-left: 22px; }
block-markdown h1, block-markdown h2, block-markdown h3, block-markdown h4 { font-size: 1.05em; margin: 8px 0 4px; }
block-markdown code { font: 12.5px monospace; background: rgba(0, 0, 0, .06); padding: 1px 4px; border-radius: 3px; }
block-markdown pre { background: var(--hover); padding: 8px; border-radius: 4px; overflow-x: auto; }
block-markdown pre code { background: none; padding: 0; }
block-markdown table { border-collapse: collapse; }
block-markdown th, block-markdown td { border: 1px solid var(--line); padding: 3px 8px; }
block-markdown blockquote { border-left: 3px solid var(--line); padding-left: 8px; color: var(--soft); }`;

export default class extends HTMLElement {
  update({ text = "" }) {
    if (!document.getElementById("block-markdown-css")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="block-markdown-css">${CSS}</style>`);
    }
    if (this.state?.text === text) return;  // unchanged: keep the DOM (and any selection)
    this.state = { text };
    this.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
    for (const a of this.querySelectorAll("a")) { a.target = "_blank"; a.rel = "noopener"; }
  }
}
