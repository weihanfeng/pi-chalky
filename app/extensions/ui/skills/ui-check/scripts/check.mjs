// Open a page in headless Chrome, act on it, and report what a user would hit. (Node port of check.py.)
//
// usage: node check.mjs URL [STEP ...] [--size 1280x800] [--shot out.png] [--full] [--fit SELECTOR]
// steps, run in order after the page loads:
//   wait:MS            wait MS milliseconds (the page gets 1500 ms after load before the first step)
//   click:SELECTOR     click the centre of the first element matching the CSS selector
//   drag:SELECTOR=DX,DY  press on its centre, move DX,DY px (in steps, button held), release
//   altdrag:SELECTOR=DX,DY  the same with Alt (Option) held down
//   hold:SELECTOR=MS   press on its centre, keep the button down MS milliseconds without moving, release
//   dblclick:SELECTOR  double-click the centre of the first match
//   type:SELECTOR=TEXT focus the element and type TEXT
//   key:KEY            press a key: Enter, Escape, Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, or a letter
//   eval:JS            run a JavaScript expression; its value is printed (promises are awaited)
//   shot:PATH          screenshot now (a page can be captured several times)
//   dialog:accept      answer later confirm()/alert()/prompt() dialogs with OK (dialog:accept=TEXT types TEXT into a
//                      prompt); dialog:dismiss answers Cancel. Default: dismiss, so a confirm on the live page doesn't act.
// --fit SELECTOR: the --shot shows just the box around every element matching SELECTOR (even parts outside the
// window), plus a margin, in the window's shape. Nothing matching: the plain shot.
// Prints: errors (exceptions, console errors, failed requests), layout problems (clipped or overflowing
// elements, cut-off text), step results, every dialog and how it was answered, screenshot paths. Exit code 1 if
// a step failed or there were errors; layout problems alone don't count (some are meant: the agent judges them,
// and pi shows an exit code 1 as a failed command); 2 if there is no browser (it prints the command that downloads one).
// Talks to Chrome over the DevTools Protocol (CDP) with Node's own WebSocket and fetch; no libraries.
// The browser: $CHROME, else chrome-headless-shell downloaded into BROWSERS, else an installed Chrome, Chromium or Edge.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSERS = process.env.CHALKY_BROWSERS || path.join(os.homedir(), ".cache", "chalky-browsers");
const DOWNLOAD = `npx --yes @puppeteer/browsers@3.2.4 install chrome-headless-shell@155.0.8059.84 --path "${BROWSERS}"`;
const SHELL = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
const INSTALLED = {
  linux: ["/usr/local/bin/chrome-headless-shell", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`],
}[process.platform] ?? [];

function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const downloaded = fs.existsSync(BROWSERS) ? fs.readdirSync(BROWSERS, { recursive: true }).map(String)
    .filter((p) => path.basename(p) === SHELL).map((p) => path.join(BROWSERS, p)).sort().at(-1) : undefined;
  return downloaded ?? INSTALLED.find((p) => fs.existsSync(p));
}

const KEYS = { Enter: ["\r", 13], Escape: ["", 27], Tab: ["\t", 9], Space: [" ", 32], ArrowUp: ["", 38],
  ArrowDown: ["", 40], ArrowLeft: ["", 37], ArrowRight: ["", 39], Backspace: ["", 8] };

// Layout problems, found in the page itself. Inside scrollable boxes overflow is normal, so only boxes that
// hide overflow (hidden/clip) count as clipping. Canvas drawings are pixels: check those on the screenshot.
const LAYOUT = String.raw`(() => {
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const shown = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && r.width > 0 && r.height > 0; };
  const out = [], W = innerWidth;
  if (document.documentElement.scrollWidth > W + 1)
    out.push('page scrolls sideways: content is ' + document.documentElement.scrollWidth + 'px wide, window ' + W + 'px');
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName) || !shown(el)) continue;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    const leaf = !el.children.length || ['CANVAS', 'IMG', 'SVG', 'svg', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (leaf && (r.right > W + 1 || r.left < -1)) out.push(name(el) + ' sticks out of the window (x ' + Math.round(r.left) + '..' + Math.round(r.right) + ', window 0..' + W + ')');
    if (leaf) for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a); if (!/hidden|clip/.test(o.overflow + o.overflowX + o.overflowY)) continue;
      const b = a.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1)
        out.push(name(el) + ' is cut off by ' + name(a) + ' (element ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' at ' + Math.round(r.left) + ',' + Math.round(r.top)
          + '; box ' + Math.round(b.width) + 'x' + Math.round(b.height) + ' at ' + Math.round(b.left) + ',' + Math.round(b.top) + ')');
      break;
    }
    if (el.children.length === 0 && el.textContent.trim() && /hidden|clip/.test(s.overflow + s.overflowX) && el.scrollWidth > el.clientWidth + 1)
      out.push(name(el) + ' text is cut off: "' + el.textContent.trim().slice(0, 40) + '"');
  }
  const box = el => { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const big = [...document.body.children].filter(shown).map(el => name(el) + ' ' + box(el)).join(', ');
  return {title: document.title, window: W + 'x' + innerHeight, top_level: big, problems: [...new Set(out)].slice(0, 40)};
})()`;

// The box around all matches, in page coordinates (scrolling included): 32px margin, at least half the window,
// widened or heightened to the window's shape and kept centred on the matches (not past the page's top or left).
const FIT = `((sel, W, H) => {  // W x H: the window as asked for (it may be enlarged before the second measure)
  const rs = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rs.length) return null;
  const m = 32, ratio = W / H;
  const x0 = Math.min(...rs.map(r => r.left)) + scrollX - m, x1 = Math.max(...rs.map(r => r.right)) + scrollX + m;
  const y0 = Math.min(...rs.map(r => r.top)) + scrollY - m, y1 = Math.max(...rs.map(r => r.bottom)) + scrollY + m;
  let w = Math.max(x1 - x0, W / 2), h = Math.max(y1 - y0, H / 2);
  if (w / h < ratio) w = h * ratio; else h = w / ratio;
  return { x: Math.max(0, (x0 + x1 - w) / 2), y: Math.max(0, (y0 + y1 - h) / 2), width: w, height: h, scale: 1 };
})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.pending = new Map(); this.events = [];
    this.dialog = [false, ""];  // how to answer dialogs: [accept, prompt text]; dismiss by default
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
      else if (msg.method) {
        this.events.push(msg);
        if (msg.method === "Page.javascriptDialogOpening") this.answer(msg.params);  // the page is blocked until answered
      }
    });
  }
  async answer(dialog) {
    const [accept, text] = this.dialog;
    await this.call("Page.handleJavaScriptDialog", { accept, promptText: text });
    console.log(`dialog ${dialog.type} "${dialog.message.slice(0, 100)}" -> ${accept ? "accepted" : "dismissed"}`
      + (accept && dialog.type === "prompt" ? ` with ${JSON.stringify(text)}` : ""));
  }
  call(method, params = {}) {
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in 30 s`)); }, 30000);
      this.pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async js(expression) {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function shot(page, file, full, fit) {
  const [w, h] = await page.js("[innerWidth, innerHeight]");
  let clip = fit && await page.js(`${FIT}(${JSON.stringify(fit)}, ${w}, ${h})`);
  let r;
  if (clip) {  // parts outside the window aren't drawn if the page scrolls inside an element: make the window reach
    if (clip.x + clip.width > w || clip.y + clip.height > h) {
      await page.call("Emulation.setDeviceMetricsOverride", { width: Math.floor(Math.max(w, clip.x + clip.width) + 1),
        height: Math.floor(Math.max(h, clip.y + clip.height) + 1), deviceScaleFactor: 1, mobile: false });
      await sleep(500);  // relayout, and apps that redraw on resize
      clip = (await page.js(`${FIT}(${JSON.stringify(fit)}, ${w}, ${h})`)) ?? clip;
    }
    r = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
  } else r = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return `screenshot: ${path.resolve(file)}`;
}

async function centre(page, sel) {  // the centre of the first match, scrolled into view
  const box = await page.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
  if (!box) throw new Error(`no element matches ${sel}`);
  return box;
}

const split = (s, sep, last = false) => {  // [before, after] at the first (or last) sep; [s, ""] if none
  const i = last ? s.lastIndexOf(sep) : s.indexOf(sep);
  return i < 0 ? (last ? ["", s] : [s, ""]) : [s.slice(0, i), s.slice(i + sep.length)];
};
const mouse = (page, type, x, y, extra = {}) => page.call("Input.dispatchMouseEvent", { type, x, y, ...extra });

async function step(page, s, full) {
  const [kind, arg] = split(s, ":");
  if (kind === "wait") { await sleep(Number(arg)); return `waited ${arg} ms`; }
  if (kind === "drag" || kind === "altdrag") {
    const [sel, by] = split(arg, "=", true);  // the last "=": selectors may contain one ([data-x=y])
    const [dx, dy] = by.split(",").map(Number);
    const { x, y } = await centre(page, sel), modifiers = kind === "altdrag" ? 1 : 0;  // CDP modifiers: 1 = Alt
    await mouse(page, "mouseMoved", x, y, { modifiers });
    await mouse(page, "mousePressed", x, y, { button: "left", clickCount: 1, modifiers });
    for (let i = 1; i <= 10; i++) {
      await mouse(page, "mouseMoved", x + dx * i / 10, y + dy * i / 10, { button: "left", buttons: 1, modifiers });
      await sleep(30);
    }
    await mouse(page, "mouseReleased", x + dx, y + dy, { button: "left", clickCount: 1, modifiers });
    await sleep(300);
    return `${modifiers ? "alt-" : ""}dragged ${sel} by ${dx},${dy}`;
  }
  if (kind === "hold") {
    const [sel, ms] = split(arg, "=", true);
    const { x, y } = await centre(page, sel);
    await mouse(page, "mouseMoved", x, y);
    await mouse(page, "mousePressed", x, y, { button: "left", clickCount: 1 });
    await sleep(Number(ms));
    await mouse(page, "mouseReleased", x, y, { button: "left", clickCount: 1 });
    await sleep(300);
    return `held ${sel} for ${ms} ms`;
  }
  if (kind === "dblclick") {
    const { x, y } = await centre(page, arg);
    for (const clickCount of [1, 2]) for (const t of ["mousePressed", "mouseReleased"]) await mouse(page, t, x, y, { button: "left", clickCount });
    await sleep(300);
    return `double-clicked ${arg}`;
  }
  if (kind === "click") {
    const { x, y } = await centre(page, arg);
    for (const t of ["mousePressed", "mouseReleased"]) await mouse(page, t, x, y, { button: "left", clickCount: 1 });
    await sleep(300);
    return `clicked ${arg}`;
  }
  if (kind === "type") {
    const [sel, text] = split(arg, "=");
    if (!await page.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.focus(); return !!el; })()`))
      throw new Error(`no element matches ${sel}`);
    await page.call("Input.insertText", { text });
    return `typed into ${sel}`;
  }
  if (kind === "key") {
    const [text, code] = KEYS[arg] ?? [arg, arg.length === 1 ? arg.toUpperCase().charCodeAt(0) : 0];
    await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: arg, text, windowsVirtualKeyCode: code });
    await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: arg, windowsVirtualKeyCode: code });
    await sleep(200);
    return `pressed ${arg}`;
  }
  if (kind === "eval") return `eval ${arg.slice(0, 60)} -> ${String(JSON.stringify(await page.js(arg))).slice(0, 2000)}`;
  if (kind === "shot") return shot(page, arg, full);
  if (kind === "dialog") {
    const [answer, text] = split(arg, "=");
    if (!["accept", "dismiss"].includes(answer)) throw new Error("dialog:accept, dialog:accept=TEXT or dialog:dismiss");
    page.dialog = [answer === "accept", text];
    return `dialogs from now on: ${answer}` + (text ? ` with ${JSON.stringify(text)}` : "");
  }
  throw new Error(`unknown step ${JSON.stringify(s)} (wait, click, drag, altdrag, hold, dblclick, type, key, eval, shot, dialog)`);
}

function problems(events) {  // errors from the events Chrome sent: uncaught exceptions, console errors, failed requests
  const out = [];
  for (const { method: m, params: p } of events) {
    if (m === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails;
      out.push(`exception: ${d.exception?.description ?? d.text}`.split("\n    at ")[0]);
    } else if (m === "Runtime.consoleAPICalled" && ["error", "assert"].includes(p.type))
      out.push(("console.error: " + p.args.map((a) => String(a.value ?? a.description ?? "")).join(" ")).slice(0, 300));
    else if (m === "Log.entryAdded" && p.entry.level === "error") out.push(`browser: ${p.entry.text.slice(0, 300)} ${p.entry.url ?? ""}`.trim());
    else if (m === "Network.responseReceived" && p.response.status >= 400) out.push(`HTTP ${p.response.status}: ${p.response.url}`);
    else if (m === "Network.loadingFailed" && !p.canceled) out.push(`request failed: ${p.errorText} (request ${p.requestId})`);
  }
  return [...new Set(out)];
}

async function main(url, steps, size, shotPath, full, fit) {
  const chromePath = findBrowser();
  if (!chromePath) {
    console.log(`no headless browser found (looked at $CHROME, ${BROWSERS}, and the usual Chrome, Chromium and Edge places).\n`
      + `Download one (about 270 MB on disk, once), then run this again:\n  ${DOWNLOAD}`);
    return 2;
  }
  const [w, h] = size.split("x").map(Number);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-check-"));
  const headless = path.basename(chromePath).startsWith("chrome-headless-shell") ? [] : ["--headless"];  // a full browser: no window
  const chrome = spawn(chromePath, [...headless, "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  let failed = false, page, layout;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !(fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").trim()); i++) await sleep(100);  // written once ready
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("could not connect to the browser")); });
    page = new Page(ws);
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await page.call(`${domain}.enable`);
    await page.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.call("Page.navigate", { url });
    let loaded = false;
    for (let i = 0; i < 150 && !(loaded = page.events.some((e) => e.method === "Page.loadEventFired")); i++) await sleep(100);  // up to 15 s
    if (!loaded) { console.log("problem: the page did not finish loading in 15 s"); failed = true; }
    await sleep(1500);  // scripts, sockets and first renders
    console.log(`opened ${url} at ${size}`);
    for (const st of steps) {
      try { console.log(await step(page, st, full)); } catch (e) { console.log(`step failed: ${st}: ${e.message}`); failed = true; }
    }
    layout = await page.js(LAYOUT);
    if (shotPath) console.log(await shot(page, shotPath, full, fit));
    ws.close();
    const errors = problems(page.events);
    console.log(`title: ${JSON.stringify(layout.title)}, window ${layout.window}; top-level elements: ${layout.top_level}`);
    console.log(`errors (${errors.length}):` + errors.map((e) => `\n  - ${e}`).join(""));
    console.log(`layout problems (${layout.problems.length}):` + layout.problems.map((p) => `\n  - ${p}`).join(""));
    failed = failed || errors.length > 0;  // layout problems: printed, for the agent to judge
  } finally {
    chrome.kill();
    await new Promise((r) => chrome.exitCode !== null ? r() : chrome.on("exit", r));
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

const args = process.argv.slice(2);
if (!args.length || ["-h", "--help"].includes(args[0])) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\nimport ")[0].replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}
const steps = [];
let size = "1280x800", shotPath = null, full = false, fit = null;
const rest = args.slice(1);
while (rest.length) {
  const a = rest.shift();
  if (a === "--size") size = rest.shift();
  else if (a === "--shot") shotPath = rest.shift();
  else if (a === "--full") full = true;
  else if (a === "--fit") fit = rest.shift();
  else steps.push(a);
}
process.exit(await main(args[0], steps, size, shotPath, full, fit));
