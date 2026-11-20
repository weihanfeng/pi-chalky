// The "chalky" provider: the MODEL_BASE_URL endpoint (in Chalky: keyproxy -> LiteLLM), a pi dynamic provider
// (pi's custom-provider docs, "Supply and refresh models"; as pi narrows OpenRouter to a key's models). Registered
// with MODEL_NAME only; pi's refresh fetches what the endpoint offers now (GET MODEL_BASE_URL/models: LiteLLM answers
// with the routes the key allows, and their context sizes) and keeps the last list when it can't. Refreshed when an
// agent starts (server.ts), when /model opens and after a login (login.ts). MODEL_CONTEXT_WINDOW: the context size
// when the endpoint doesn't say; pi compacts when a request would leave less than 16384 tokens of it.
const route = (id: string, context?: number, output?: number) => ({
  id, name: id, reasoning: true, input: ["text", "image"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: context ?? Number(process.env.MODEL_CONTEXT_WINDOW || 200000), maxTokens: Math.min(output ?? 16000, 16000),
});

export const provider = () => ({
  baseUrl: process.env.MODEL_BASE_URL,
  apiKey: "$MODEL_API_KEY",  // read from the environment by pi, not stored in the session
  api: "openai-completions" as const,
  compat: { supportsStore: false, supportsDeveloperRole: false },  // LiteLLM may not take "store" (pi-ai docs)
  models: [route(process.env.MODEL_NAME || "default")],
  async refreshModels(context: any): Promise<any> {  // nothing returned: pi keeps the list it has
    if (!context.allowNetwork) return undefined;
    try {
      const r = await fetch(`${process.env.MODEL_BASE_URL}/models`, {
        headers: { authorization: `Bearer ${process.env.MODEL_API_KEY}` }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]) });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const list = ((await r.json()).data ?? []).map((m: any) => route(m.id, m.max_input_tokens, m.max_output_tokens));
      return list.length ? list : undefined;
    } catch (e: any) {
      if (!context.signal.aborted) console.error(`model: ${process.env.MODEL_BASE_URL}/models failed: ${e?.message ?? e}`);
      return undefined;
    }
  },
});

// What an agent uses when it picked nothing (or its pick isn't offered any more): MODEL_NAME, else the first offered.
export const fallback = (session: any) => session.modelRuntime.getModel("chalky", process.env.MODEL_NAME || "default")
  ?? session.modelRuntime.getModels("chalky")[0];
