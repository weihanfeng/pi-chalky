// Viewer: previews of the user's files (the ones in the file extension's folder), in a window on the page (the
// browser half: browser.js). browser.js opens a window when files' browser.js fires
// "file-open"; the window lives only in that page (a note pointed at it says which file and which spot).
// Parsing happens here, one library per format (plain previews, no LibreOffice):
//   images, pdf                     shown by the browser itself, from /viewer/raw
//   csv, tsv, xlsx, xlsm, xls       a table per sheet, shown as tabs like Excel (SheetJS)
//   docx                            headings, paragraphs, list items and tables, in order (mammoth's document tree)
//   pptx                            the title and text of each slide, tables as lines (node-pptx-parser's XML trees);
//                                   no speaker notes yet (the library doesn't read the notes files)
//   doc (old Word)                  plain text (word-extractor)
//   anything else that is text      text
//   GET  /viewer/view?path=   {"kind": "image"|"pdf"|"text"|"sheets"|"doc"|"slides"|"none", ...} (see preview())
//   GET  /viewer/raw?path=    the file's bytes, images and pdf only
//   POST /viewer/shot         a png of an area the user drew around on a pdf; saved in SHOTS, returns {"path"}
// Tool viewer_read(path, offset?): the same content as text, for the agent (pdf text with unpdf). The Python tool was
// read_file; renamed so it isn't mistaken for pi's read (text and pictures, which the guide now names for pictures).
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import PptxParser from "node-pptx-parser";
import WordExtractor from "word-extractor";
import { extractText, getDocumentProxy } from "unpdf";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;
const DIR = path.join(host.workspace, "drops");  // the file extension's folder
const IMAGES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon" };
const MAX_ROWS = 1000, MAX_COLS = 60;  // per sheet shown
const MAX_TEXT = 300_000;              // characters shown
const MAX_TOOL_TEXT = 40_000;          // characters viewer_read returns
const SHOTS = path.join(host.data, "viewer");  // pictures of drawn-around pdf areas (outside the user's folder)
const MAX_SHOT = 10 * 1024 * 1024;

function inside(p: string | null) {  // the real path, if it is a file in DIR; else null (no reading elsewhere)
  try {
    const real = fs.realpathSync(p ?? "");
    return real.startsWith(fs.realpathSync(DIR) + path.sep) && fs.statSync(real).isFile() ? real : null;
  } catch { return null; }
}

function sheet(name: string, ws: XLSX.WorkSheet) {  // {name, rows, cut}: from A1, at most MAX_ROWS x MAX_COLS
  if (!ws["!ref"]) return { name, rows: [], cut: false };
  const r = XLSX.utils.decode_range(ws["!ref"]);
  const cut = r.e.r >= MAX_ROWS || r.e.c >= MAX_COLS;
  r.s = { r: 0, c: 0 };  // browser.js numbers rows and columns from the first one sent
  r.e = { r: Math.min(r.e.r, MAX_ROWS - 1), c: Math.min(r.e.c, MAX_COLS - 1) };
  // raw: false = the cell's text as Excel shows it (number formats, dates); csv cells are already that text
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, range: r, defval: "", raw: false, blankrows: true })
    .map((row) => row.map(String));
  const width = Math.max(0, ...rows.map((row) => row.findLastIndex((v) => v !== "") + 1));  // trailing empty columns dropped
  while (rows.length && rows.at(-1)!.every((v) => v === "")) rows.pop();
  return { name, rows: rows.map((row) => row.slice(0, width)), cut };
}

// docx: mammoth reads the file into its own tree (paragraphs with their style name and list numbering, tables of rows
// of cells) and hands it to transformDocument before making HTML; we keep the tree and ignore the HTML.
const textOf = (e: any): string => e.type === "text" ? e.value : e.type === "tab" ? "\t" : e.type === "break" ? "\n"
  : e.type === "paragraph" ? (e.children ?? []).map(textOf).join("")
  : e.type === "tableCell" ? e.children.filter((c: any) => c.type === "paragraph").map(textOf).join("\n")
  : (e.children ?? []).map(textOf).join("");

async function docx(p: string) {
  let tree: any;
  await mammoth.convertToHtml({ path: p }, { transformDocument: (d: any) => (tree = d) });
  const blocks = [];
  for (const b of tree.children) {
    if (b.type === "table") blocks.push({ table: b.children.map((row: any) => row.children.flatMap((c: any) => Array(c.colSpan).fill(textOf(c)))) });
    else if (b.type === "paragraph" && textOf(b).trim()) {
      // Word stores built-in style names in lower case ("heading 1"); python-docx showed them as "Heading 1"
      const style = (b.styleName ?? "").toLowerCase(), n = style.match(/^heading (\d)$/)?.[1];
      blocks.push({ text: textOf(b), heading: style === "title" ? 1 : n ? +n : 0, item: style.startsWith("list") || !!b.numbering });
    }
  }
  return { kind: "doc", blocks };
}

// pptx: node-pptx-parser gives each slide's XML as a tree (xml2js: every child is an array, attributes in "$").
// The slides come in the order of the links file, so they are put in the deck's own order (presentation.xml).
// A title is the shape that is a title placeholder; tables are lines "a | b | c"; groups are looked into.
const paraText = (pa: any) => [...(pa["a:r"] ?? []), ...(pa["a:fld"] ?? [])].map((r) => {
  const t = r["a:t"]?.[0];
  return typeof t === "string" ? t : t?._ ?? "";
}).join("");
const bodyLines = (body: any) => (body?.["a:p"] ?? []).map(paraText).filter((t: string) => t.trim());

function shapes(tree: any, out: { title: string, lines: string[] }) {
  for (const sp of tree["p:sp"] ?? []) {
    const ph = sp["p:nvSpPr"]?.[0]?.["p:nvPr"]?.[0]?.["p:ph"]?.[0]?.$?.type;
    const lines = bodyLines(sp["p:txBody"]?.[0]);
    if ((ph === "title" || ph === "ctrTitle") && !out.title) out.title = lines.join(" ");
    else out.lines.push(...lines);
  }
  for (const f of tree["p:graphicFrame"] ?? [])
    for (const tbl of f["a:graphic"]?.[0]?.["a:graphicData"]?.[0]?.["a:tbl"] ?? [])
      for (const tr of tbl["a:tr"] ?? []) out.lines.push((tr["a:tc"] ?? []).map((tc: any) => bodyLines(tc["a:txBody"]?.[0]).join("\n")).join(" | "));
  for (const g of tree["p:grpSp"] ?? []) shapes(g, out);
}

async function pptx(p: string) {
  const { presentation, slides } = await new PptxParser(p).parse();
  const order = (presentation.parsed["p:presentation"]["p:sldIdLst"]?.[0]["p:sldId"] ?? []).map((s: any) => s.$["r:id"]);
  slides.sort((a: any, b: any) => order.indexOf(a.id) - order.indexOf(b.id));
  return { kind: "slides", slides: slides.map((s: any) => {
    const out = { title: "", lines: [] as string[] };
    shapes(s.parsed["p:sld"]["p:cSld"][0]["p:spTree"][0], out);
    return { ...out, notes: "" };
  }) };
}

async function preview(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".docx") return docx(p);
  if (ext === ".pptx") return pptx(p);
  if (ext === ".doc") return { kind: "text", text: (await new WordExtractor().extract(p)).getBody().slice(0, MAX_TEXT) };
  if (ext in IMAGES) return { kind: "image" };
  if (ext === ".pdf") return { kind: "pdf" };
  if (ext === ".csv" || ext === ".tsv") {  // as text, cells left as written (raw: no guessing numbers or dates)
    const wb = XLSX.read(fs.readFileSync(p, "utf8").replace(/^﻿/, ""), { type: "string", raw: true, FS: ext === ".tsv" ? "\t" : "," });
    return { kind: "sheets", sheets: [sheet(path.basename(p), wb.Sheets[wb.SheetNames[0]])] };
  }
  if (ext === ".xlsx" || ext === ".xlsm" || ext === ".xls") {
    const wb = XLSX.read(fs.readFileSync(p), { sheetRows: MAX_ROWS + 1 });  // only read what can be shown (+1 to know it was cut)
    return { kind: "sheets", sheets: wb.SheetNames.map((n) => sheet(n, wb.Sheets[n])) };
  }
  const fd = fs.openSync(p, "r"), head = Buffer.alloc(MAX_TEXT);  // anything else: text if it looks like text
  const n = fs.readSync(fd, head, 0, MAX_TEXT, 0);
  fs.closeSync(fd);
  if (head.subarray(0, Math.min(n, 8192)).includes(0)) return { kind: "none", reason: `No preview for ${ext || "this kind of"} files.` };
  return { kind: "text", text: head.subarray(0, n).toString("utf8"), cut: fs.statSync(p).size > MAX_TEXT };
}

async function asText(p: string): Promise<string> {  // what viewer_read returns: the preview, written out as text
  const v: any = await preview(p);
  if (v.kind === "image") return `${p} is an image: look at it with read.`;
  if (v.kind === "pdf") {
    const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(fs.readFileSync(p))));
    return text.map((t, i) => `--- page ${i + 1} of ${totalPages} ---\n${t}`).join("\n\n");
  }
  if (v.kind === "sheets") return v.sheets.map((s: any) =>
    `--- sheet ${s.name} (${s.rows.length} rows${s.cut ? ", cut" : ""}) ---\n${XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(s.rows))}\n`).join("\n");
  if (v.kind === "doc") return v.blocks.map((b: any) => b.table ? "[table]\n" + b.table.map((r: string[]) => r.join(" | ")).join("\n")
    : (b.heading ? "#".repeat(b.heading) + " " : b.item ? "- " : "") + b.text).join("\n");
  if (v.kind === "slides") return v.slides.map((s: any, i: number) => `--- slide ${i + 1}: ${s.title} ---\n` + s.lines.join("\n")
    + (s.notes ? `\n[notes] ${s.notes}` : "")).join("\n\n");
  return v.text ?? v.reason ?? "";
}

const json = (res: any, v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));

export default function (pi: ExtensionAPI) {

  host.routes.set("/viewer/view", async (req: any, res: any) => {
    const p = inside(new URL(req.url, "http://x").searchParams.get("path"));
    if (!p) return json(res, { error: "no such file in " + DIR }, 404);
    try { json(res, await preview(p)); }
    catch (e: any) { json(res, { kind: "none", reason: `Could not read this file: ${e.name}: ${e.message}` }); }  // a broken or unusual file
  });

  host.routes.set("/viewer/raw", (req: any, res: any) => {
    const p = inside(new URL(req.url, "http://x").searchParams.get("path"));
    const ext = path.extname(p ?? "").toLowerCase();
    if (!p || !(ext in IMAGES || ext === ".pdf")) return res.writeHead(404).end();
    const headers: Record<string, string> = { "content-type": IMAGES[ext] ?? "application/pdf" };
    if (ext === ".svg") headers["content-security-policy"] = "sandbox";  // an SVG's scripts never run, even opened on its own
    res.writeHead(200, headers);
    fs.createReadStream(p).pipe(res);
  });

  host.routes.set("/viewer/shot", (req: any, res: any) => {
    if (req.method !== "POST") return res.writeHead(405).end();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_SHOT) chunks.push(c); });
    req.on("end", () => {
      const data = Buffer.concat(chunks);
      if (size > MAX_SHOT || !data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
        return json(res, { error: "not a png, or over 10 MB" }, 400);
      fs.mkdirSync(SHOTS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const p = path.join(SHOTS, `${stamp}-${process.hrtime.bigint() % 1000000n}.png`);
      fs.writeFileSync(p, data);
      json(res, { path: p });
    });
  });


  pi.registerTool({
    name: "viewer_read", label: "Viewer read", exposure: "deferred",
    description: "Read a document as text: docx, pptx, xlsx, xls, csv, pdf, doc, or any text file "
      + "(sheets come back as CSV, slides and pages numbered).",
    parameters: Type.Object({ path: Type.String(),
      offset: Type.Optional(Type.Number({ description: "the character to start from, to read on in a long document" })) }),
    async execute(_id, { path: p, offset = 0 }) {
      let text: string;
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) text = `error: no file ${p}`;
      else {
        try {
          const whole = await asText(p), end = offset + MAX_TOOL_TEXT;
          text = whole.slice(offset, end);
          if (end < whole.length) text += `\n[... cut: ${whole.length} characters in all; call again with offset=${end} for the rest]`;
        } catch (e: any) { text = `error: could not read ${p}: ${e.name}: ${e.message}`; }
      }
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

}
