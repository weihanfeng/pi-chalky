// The model the agents use: the one picked on the page (login.ts: sign-ins, custom endpoints, the picker; browser.js:
// /login, /logout, /model), else the endpoint set in the environment (here): one OpenAI-compatible endpoint (in
// Chalky: keyproxy -> LiteLLM). MODEL_BASE_URL (up to /v1), MODEL_API_KEY, MODEL_NAME (a LiteLLM route, "default").
// pi does the calls, streaming, retries, thinking and compaction; this only tells it where. The host selects provider
// "chalky" when nothing was picked (server.ts). MODEL_CONTEXT_WINDOW: the model's context size; pi compacts when a
// request would leave less than 16384 tokens of it.
// CHALKY_LOGIN=off (hosted): the endpoint's own list (GET MODEL_BASE_URL/models: LiteLLM answers with the routes the
// project owner's tier allows, and each one's context size), so /model picks among them. Else, or if that fails:
// MODEL_NAME only.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import login from "./login.ts";

const route = (id: string, context?: number, output?: number) => ({
  id, name: id, reasoning: true, input: ["text", "image"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: context ?? Number(process.env.MODEL_CONTEXT_WINDOW || 200000), maxTokens: Math.min(output ?? 16000, 16000),
});

async function routes() {
  const fixed = route(process.env.MODEL_NAME || "default");
  if (process.env.CHALKY_LOGIN !== "off") return [fixed];
  try {
    const r = await fetch(`${process.env.MODEL_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${process.env.MODEL_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const list = ((await r.json()).data ?? []).map((m: any) => route(m.id, m.max_input_tokens, m.max_output_tokens));
    return list.some((m: any) => m.id === fixed.id) ? list : [fixed, ...list];
  } catch (e: any) {
    console.error(`model: the list of models (${process.env.MODEL_BASE_URL}/models) failed: ${e?.message ?? e}; only ${fixed.id}`);
    return [fixed];
  }
}

export default async function (pi: ExtensionAPI) {
  login(pi);  // CHALKY_LOGIN=off (hosted): no sign-ins, only the picker over this endpoint's models
  if (!process.env.MODEL_BASE_URL) return;  // pi then says no model is configured on each message
  pi.registerProvider("chalky", {
    baseUrl: process.env.MODEL_BASE_URL,
    apiKey: "$MODEL_API_KEY",  // read from the environment by pi, not stored in the session
    api: "openai-completions",
    compat: { supportsStore: false, supportsDeveloperRole: false },  // LiteLLM may not take "store" (pi-ai docs)
    models: await routes(),
  });
}
