// Drive a headless Chrome through its DevTools port: open the page, run some JavaScript in it, save a screenshot.
//   node tests/browse.mjs <out.png> '<js to run on the page: the body of an async function>' [port]
// Chrome must be running with --remote-debugging-port (see NOTES.md, "Tests"). PORT: Chalky's, default 3000.
import fs from "node:fs";
import WebSocket from "ws";

const [out, js = "", port = "9333"] = process.argv.slice(2);
const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
const sock = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => sock.on("open", r));
let id = 0;
const call = (method, params = {}) => new Promise((resolve) => {
  const me = ++id;
  sock.on("message", function on(m) { const r = JSON.parse(m); if (r.id === me) { sock.off("message", on); resolve(r.result); } });
  sock.send(JSON.stringify({ id: me, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 850, deviceScaleFactor: 1, mobile: false });
await call("Page.navigate", { url: `http://127.0.0.1:${process.env.PORT || 3000}/` });
await wait(3000);  // the page loads its browser parts and replays the record
const r = js && await call("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
if (r) console.log(r.exceptionDetails?.exception?.description ?? r.result?.value);
await wait(1500);
fs.writeFileSync(out, Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
console.log("written", out);
sock.close();
