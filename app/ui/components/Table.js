// Table: rows of data under column headers.
export const about = {
  "version": 1,
  "props": {
    "columns": {"type": "list", "doc": "column headers"},
    "rows": {"type": "rows", "doc": "one array per row, a value per column; often {\"path\": \"/rows\"}"}
  },
  "children": "none",
  "levers": [],
  "accepts": "rows: a list with one array per row",
  "example": {"columns": ["Name", "Dish", "S$"], "rows": [["S. Tan", "Laksa", 6.0], ["R. Lim", "Chicken rice", 5.5]]}
};
export default class extends HTMLElement {
  update({ columns = [], rows = [] }) {
    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums";
    const cell = (tag, text) => {
      const c = document.createElement(tag);
      c.textContent = text ?? "";
      c.style.cssText = "border-bottom:1px solid var(--line);padding:6px 10px;text-align:left" +
        (tag === "th" ? ";color:var(--muted);font-weight:500" : "");
      return c;
    };
    table.append(...[columns, ...rows].map((row, i) => {
      const tr = document.createElement("tr");
      tr.append(...row.map((v) => cell(i ? "td" : "th", v)));
      return tr;
    }));
    this.replaceChildren(table);
  }
}
