// The model the agents use: the one picked on the page (login.ts: sign-ins, custom endpoints, the picker; browser.js:
// /login, /logout, /model), else the endpoint set in the environment (here): one OpenAI-compatible endpoint (in
// Chalky: keyproxy -> LiteLLM). MODEL_BASE_URL (up to /v1), MODEL_API_KEY, MODEL_NAME (a LiteLLM route, "default").
// pi does the calls, streaming, retries, thinking and compaction; this only tells it where. The host selects provider
// "chalky" when nothing was picked (server.ts); which models it has: routes.ts.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import login from "./login.ts";
import { provider } from "./routes.ts";

export default function (pi: ExtensionAPI) {
  login(pi);  // CHALKY_LOGIN=off (hosted): no sign-ins or custom endpoints, only the picker
  if (!process.env.MODEL_BASE_URL) return;  // pi then says no model is configured on each message
  pi.registerProvider("chalky", provider());  // routes.ts: which models
}
