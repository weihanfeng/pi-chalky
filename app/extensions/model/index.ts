// The model: one OpenAI-compatible endpoint (in Chalky: keyproxy -> LiteLLM), as the Python agent's llm plugin.
// MODEL_BASE_URL (up to /v1), MODEL_API_KEY, MODEL_NAME (a LiteLLM route, "default"). pi does the calls,
// streaming, retries, thinking and compaction; this only tells it where. The host selects provider "chalky".
// MODEL_CONTEXT_WINDOW: the model's context size; pi compacts when a request would leave less than 16384 tokens of it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
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
