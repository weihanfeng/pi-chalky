// Voice input: speech to text. The browser half: a microphone button by the send
// button (browser.js) and /voice/voice.js, which apps can import too.
// Settings (environment, like MODEL_*): STT_BASE_URL, STT_MODEL, STT_API_KEY. With STT_BASE_URL set, audio goes to
// POST {STT_BASE_URL}/audio/transcriptions, OpenAI's endpoint, which most providers speak (OpenAI, Groq, Mistral,
// vLLM; others through LiteLLM). Without it, voice.js uses the browser's own speech recognition.
// The key stays here: apps are agent-written code, so they post audio to this server, never to the provider.
//   GET  /voice/config      {"api": true | false}: whether audio can go to the API
//   POST /voice/transcribe  multipart: file (a complete audio file, e.g. chunk.webm), language?, prompt?
//   GET  /voice/voice.js    the browser side, for the page (browser.js) and for apps
//                               -> {"text"} or {"error"} (with the provider's status)
import { Readable } from "node:stream";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const host = (globalThis as any).chalky;

export default function (_pi: ExtensionAPI) {
  const base = (process.env.STT_BASE_URL || "").replace(/\/$/, "");
  const json = (res: any, status: number, data: object) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));

  host.routes.set("/voice/voice.js", (_req: any, res: any) => host.file(res, `${import.meta.dirname}/voice.js`));
  host.routes.set("/voice/config", (_req: any, res: any) => json(res, 200, { api: !!base }));

  host.routes.set("/voice/transcribe", async (req: any, res: any) => {
    if (!base) return json(res, 400, { error: "no STT_BASE_URL: use the browser's speech recognition" });
    try {
      // the page's form as is, plus the model (Node reads multipart itself: Request.formData)
      const form = await new Request("http://local", { method: "POST", headers: req.headers,
        body: Readable.toWeb(req) as any, duplex: "half" } as any).formData();
      if (!(form.get("file") instanceof Blob)) return json(res, 400, { error: "no audio file" });
      form.set("model", process.env.STT_MODEL || "whisper-1");
      const r = await fetch(`${base}/audio/transcriptions`, { method: "POST", body: form,
        headers: process.env.STT_API_KEY ? { authorization: `Bearer ${process.env.STT_API_KEY}` } : {} });
      const data: any = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 502, { error: `speech to text: ${r.status} ${data.error?.message ?? ""}`.trim() });
      json(res, 200, { text: data.text ?? "" });
    } catch (e: any) { json(res, 502, { error: `speech to text: ${e.message}` }); }
  });
}
