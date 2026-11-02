// The model the agents use: the one picked on the page (login.ts: sign-ins, custom endpoints, the picker; browser.js:
// /login, /logout, /model), else the endpoint set in the environment (here): one OpenAI-compatible endpoint (in
// Chalky: keyproxy -> LiteLLM). MODEL_BASE_URL (up to /v1), MODEL_API_KEY, MODEL_NAME (a LiteLLM route, "default").
// pi does the calls, streaming, retries, thinking and compaction; this only tells it where. The host selects provider
// "chalky" when nothing was picked (server.ts). MODEL_CONTEXT_WINDOW: the model's context size; pi compacts when a
// request would leave less than 16384 tokens of it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import login from "./login.ts";

export default function (pi: ExtensionAPI) {
  login(pi);  // CHALKY_LOGIN=off (a cloud deployment): no sign-ins or picker, only this endpoint
  if (!process.env.MODEL_BASE_URL) return;  // pi then says no model is configured on each message
  pi.registerProvider("chalky", {
    baseUrl: process.env.MODEL_BASE_URL,
    apiKey: "$MODEL_API_KEY",  // read from the environment by pi, not stored in the session
    api: "openai-completions",
    compat: { supportsStore: false, supportsDeveloperRole: false },  // LiteLLM may not take "store" (pi-ai docs)
    models: [{
      id: process.env.MODEL_NAME || "default", name: "Chalky default route", reasoning: true,
      input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(process.env.MODEL_CONTEXT_WINDOW || 200000), maxTokens: 16000,
    }],
  });
}
