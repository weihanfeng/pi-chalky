// The model extension's sign-ins and model picker (index.ts loads this; browser.js: the page's /login, /logout, /model):
// connect models from the page and pick one. pi's own login does the work, the call its
// terminal /login makes (modelRuntime.login): a sign-in (OAuth: pi opens the provider's page and waits on a callback
// server, or asks for the address to be pasted), or a custom endpoint (any OpenAI-, Anthropic- or Google-compatible
// URL, its model names, an optional key). pi renews sign-ins itself; an expired one shows as pi's own error.
// Where things go: tokens and keys in agent/auth.json (pi's; never versioned), custom endpoints in agent/models.json
// (pi's; no secrets), this install's device id (OpenAI's sign-in asks for one) and the model choices in data/model.json:
// {deviceId, default: {provider, id} (all agents), agents: {name: {provider, id}} (one agent's own; it wins)}.
// server.ts asks host.api.model.modelFor(name, session) when it starts an agent: its own choice, else the all-agents
// one, else nothing (then the MODEL_BASE_URL endpoint, index.ts); a choice whose login is gone is skipped.
// CHALKY_LOGIN=off (hosted: the platform's endpoint, its models set by the owner's plan): no sign-ins or custom
// endpoints, only the picker over that endpoint's models (index.ts); anyone who can open the page may change it.
//   GET /model/on       204: sign-ins and the picker; 200 (CHALKY_LOGIN=off): the picker only
//   GET /model/choices  {groups: [{provider, name, models: [{id, name, context}]}] (usable now), default, agents: [{name, model, own}]}
//   GET /model/logins   {providers: [{id, name, subscription, status}], custom: [{id, baseUrl, api, models, status}]}
//                       status: "connected" | "expired" | undefined; each call checks the stored sign-ins (pi renews one that is due)
//   page messages       model_login {provider}, model_answer {text}, model_cancel,
//                       model_custom {id, api, baseUrl, key?, models: [names]}, model_probe {baseUrl, api, key?, id?},
//                       model_logout {provider}, model_set {for: "all" | <agent>, provider?, id?} (for an agent, no provider: back to all agents')
//   event "model"       {step: "notify", event} (pi: open this link / enter this code / waiting) | {step: "prompt", prompt}
//                       (pi asks: the page answers with model_answer) | {step: "prompt_done"} (pi stopped asking: the
//                       callback came first) | {step: "done", provider} | {step: "cancelled"} | {step: "error", text} | {step: "models", models}
//                       (model_probe's answer) | {step: "changed"} (a login, endpoint or model changed: agents are synced)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ModelRuntime, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fallback } from "./routes.ts";

const host = (globalThis as any).chalky;
const MODELS = path.join(host.agent, "models.json");
const STATE = path.join(host.data, "model.json");
const APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

// one runtime for logins, on the same files as the agents' (each agent's session has its own: synced after a change)
if (!host.shared.has("model-runtime"))
  host.shared.set("model-runtime", ModelRuntime.create({ authPath: path.join(host.agent, "auth.json"), modelsPath: MODELS }));
const runtime = (): Promise<ModelRuntime> => host.shared.get("model-runtime");

// The page a sign-in's browser tab lands on is pi's (its callback server, in this process), with pi's logo: put
// Chalky's mark (a chalkboard) in its place. pi has no option for it, so the page is changed on its way out: only
// a body with pi's logo in its "logo" box (the sign-in pages), the rest of pi's page is kept as it is. Once per process.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-linecap="round">` +
  `<rect x="2" y="4" width="20" height="14" rx="2.5" fill="#2f4f45"/>` +
  `<path d="M6 12.5c1.3-2.6 2.7-2.6 4 0s2.7 2.6 4 0 2.7-2.6 4 0" stroke="#fff" stroke-width="1.6"/>` +
  `<path d="M9 21h6" stroke="#a1a1aa" stroke-width="1.6"/></svg>`;
if (!host.shared.has("model-page")) {
  host.shared.set("model-page", true);
  const end = http.ServerResponse.prototype.end as any;
  http.ServerResponse.prototype.end = function (this: any, chunk: any, ...rest: any[]) {
    if (typeof chunk === "string" && chunk.includes('<div class="logo"><svg') && chunk.includes("#F09082"))
      chunk = chunk.replace(/<div class="logo"><svg[\s\S]*?<\/svg><\/div>/, `<div class="logo">${MARK}</div>`);
    return end.call(this, chunk, ...rest);
  } as any;
}

const readModels = () => (fs.existsSync(MODELS) ? JSON.parse(fs.readFileSync(MODELS, "utf8")) : { providers: {} });
const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
const writeState = (s: any) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
function deviceId() {
  const s = readState();
  if (!s.deviceId) writeState({ ...s, deviceId: (s.deviceId = randomUUID()) });
  return s.deviceId;
}

// the model an agent should use: its own choice, else the all-agents one; skipped when its login is gone
function modelFor(name: string, session: any) {
  const s = readState(), rt = session.modelRuntime;
  for (const c of [s.agents?.[name], s.default])
    if (c && rt.hasConfiguredAuth(c.provider)) { const m = rt.getModel(c.provider, c.id); if (m) return m; }
  return undefined;
}
async function apply(a: any) {  // put an agent on the model it should use now (after a choice, a login or a logout)
  const m = modelFor(a.name, a.session) ?? fallback(a.session);
  const cur = a.session.model;
  if (m && !(cur && cur.provider === m.provider && cur.id === m.id)) await a.session.setModel(m);
}
host.api.model = { modelFor, fallback };

async function status(rt: ModelRuntime, id: string) {
  if (!rt.getProviderAuthStatus(id).configured) return undefined;
  try { return (await rt.getAuth(id)) ? "connected" : undefined; } catch { return "expired"; }  // getAuth renews a sign-in that is due
}

async function synced() {  // a login or endpoint changed: every runtime reads the files again (offline)
  await (await runtime()).refresh();
  for (const a of host.agents.values()) { await a.session.modelRuntime.refresh(); await apply(a); }
  host.broadcast("model", { step: "changed" });
}

const fail = (e: any) => host.broadcast("model", { step: "error", text: e?.message ?? String(e) });

export default function (pi: ExtensionAPI) {
  const signIn = process.env.CHALKY_LOGIN !== "off";

  // at start, once: renew the sign-ins that are due, and say which failed (server log)
  pi.on("session_start", async () => {
    if (!signIn || host.shared.has("model-checked")) return;
    host.shared.set("model-checked", true);
    const rt = await runtime();
    for (const c of await rt.listCredentials())
      if (c.type === "oauth" && (await status(rt, c.providerId)) === "expired") console.error(`login: the ${c.providerId} sign-in has expired (/login)`);
  });

  host.routes.set("/model/on", (_req: any, res: any) => res.writeHead(signIn ? 204 : 200).end());  // browser.js: which commands
  host.routes.set("/model/choices", (_req: any, res: any) => models(res).catch((e) =>
    res.writeHead(500, { "content-type": "text/plain" }).end(String(e?.message ?? e))));
  async function models(res: any) {  // read through an agent's runtime: it also has the MODEL_BASE_URL endpoint ("chalky")
    const agents = [...host.agents.values()], s = readState();
    for (const a of agents) {  // the MODEL_BASE_URL endpoint's models as of now (routes.ts); an agent whose model
      await a.session.modelRuntime.refresh({ providers: ["chalky"] });  // isn't offered any more moves at once
      await apply(a);
    }
    const rt = agents[0]?.session.modelRuntime;
    const groups = new Map<string, any>();
    for (const m of rt ? await rt.getAvailable() : []) {
      if (!groups.has(m.provider)) groups.set(m.provider, { provider: m.provider, name: m.provider === "chalky" ? (signIn ? "Chalky LiteLLM (MODEL_BASE_URL)" : "Chalky")
        : (readModels().providers[m.provider] ? `${m.provider} (custom)` : rt.getProvider(m.provider)?.name ?? m.provider), models: [] });
      groups.get(m.provider).models.push({ id: m.id, name: m.name, context: m.contextWindow });
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      groups: [...groups.values()], default: s.default ?? null,
      agents: agents.filter((a) => !a.app).map((a) => ({ name: a.name, model: a.session.model ? { provider: a.session.model.provider, id: a.session.model.id } : null,
        own: !!s.agents?.[a.name] })) }));
  }

  if (signIn) host.routes.set("/model/logins", (_req: any, res: any) => list(res).catch((e) =>
    res.writeHead(500, { "content-type": "text/plain" }).end(String(e?.message ?? e))));
  async function list(res: any) {
    const rt = await runtime();
    await rt.refresh();
    const custom = readModels().providers;
    const providers = await Promise.all(rt.getProviders().filter((p) => p.auth.oauth && !(p.id in custom)).map(async (p) =>
      ({ id: p.id, name: p.name, subscription: p.auth.oauth!.isSubscription === true, status: await status(rt, p.id) })));
    const list = await Promise.all(Object.entries(custom).map(async ([id, p]: any) =>
      ({ id, baseUrl: p.baseUrl, api: p.api, models: (p.models ?? []).map((m: any) => m.id), status: await status(rt, id) })));
    res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ providers: providers.sort((a, b) => a.name.localeCompare(b.name)), custom: list }));
  }

  host.pageHandlers.set("model", async (msg: any) => {
    if (!signIn && msg.type !== "model_set") return;  // hosted: picking only
    const flow = host.shared.get("model-flow");  // the sign-in under way: {abort, answer?}
    if (msg.type === "model_answer") return flow?.answer?.(String(msg.text ?? ""));
    if (msg.type === "model_cancel") return flow?.abort.abort();

    if (msg.type === "model_login") {
      flow?.abort.abort();  // one at a time
      const abort = new AbortController(), me: any = { abort };
      host.shared.set("model-flow", me);
      try {
        await (await runtime()).login(String(msg.provider), "oauth", {
          signal: abort.signal,
          notify: (event) => host.broadcast("model", { step: "notify", event }),
          prompt: ({ signal, ...prompt }) => new Promise((resolve, reject) => {
            const signals = [signal, abort.signal].filter((s) => s) as AbortSignal[];
            const end = () => { me.answer = undefined; for (const s of signals) s.removeEventListener("abort", stop); };
            me.answer = (text: string) => { end(); resolve(text); };
            const stop = () => { end(); host.broadcast("model", { step: "prompt_done" }); reject(new Error("Login cancelled")); };
            for (const s of signals) s.addEventListener("abort", stop, { once: true });
            host.broadcast("model", { step: "prompt", prompt });
          }),
        }, { getDeviceId: deviceId });
        await synced();
        host.broadcast("model", { step: "done", provider: msg.provider });
      } catch (e) { if (abort.signal.aborted) host.broadcast("model", { step: "cancelled" }); else fail(e); }  // ✕: not an error
      finally { if (host.shared.get("model-flow") === me) host.shared.delete("model-flow"); }
    }

    if (msg.type === "model_custom") {
      const id = String(msg.id ?? "").trim(), baseUrl = String(msg.baseUrl ?? "").trim().replace(/\/+$/, "");
      const models = [...new Set<string>((msg.models ?? []).map((m: any) => String(m).trim()).filter(Boolean))];
      const rt = await runtime(), saved = readModels();
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return fail("The name can have letters, digits, '.', '_' and '-' only");
      if (rt.getProvider(id) && !(id in saved.providers)) return fail(`'${id}' is one of pi's own providers: pick another name`);
      if (!/^https?:\/\//.test(baseUrl)) return fail("The base URL starts with http:// or https://");
      if (!APIS.includes(msg.api)) return fail(`Speaks: one of ${APIS.join(", ")}`);
      if (!models.length) return fail("Add at least one model name");
      const key = String(msg.key ?? "").trim();
      const stored = (await rt.listCredentials()).some((c) => c.providerId === id);
      // no key and none stored: a placeholder, so pi counts the endpoint usable (pi's docs: Ollama ignores it)
      saved.providers[id] = { baseUrl, api: msg.api, ...(key || stored ? {} : { apiKey: "none" }), models: models.map((m) => ({ id: m })) };
      fs.writeFileSync(MODELS, JSON.stringify(saved, null, 2) + "\n");
      try {
        await rt.refresh();
        if (key) await rt.login(id, "api_key", { prompt: async () => key, notify() {} });  // pi saves it in auth.json
        await synced();
        host.broadcast("model", { step: "done", provider: id });
      } catch (e) { fail(e); }
    }

    if (msg.type === "model_probe") {  // the endpoint's own list (GET <baseUrl>/models); the key never goes to the page
      try {
        const rt = await runtime(), baseUrl = String(msg.baseUrl ?? "").trim().replace(/\/+$/, "");
        const key = String(msg.key ?? "").trim() || (msg.id && rt.getProviderAuthStatus(msg.id).configured ? (await rt.getAuth(msg.id))?.auth.apiKey : "");
        const headers: Record<string, string> = msg.api === "anthropic-messages" ? { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" }
          : msg.api === "google-generative-ai" ? { "x-goog-api-key": key ?? "" } : key ? { authorization: `Bearer ${key}` } : {};
        const r = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return fail(`${baseUrl}/models answered ${r.status} ${r.statusText}`);
        const body = await r.json();
        const models = (body.data ?? body.models ?? []).map((m: any) => m.id ?? m.name?.replace(/^models\//, "")).filter(Boolean);
        host.broadcast("model", { step: "models", models });
      } catch (e) { fail(e); }
    }

    if (msg.type === "model_set") {
      const s = readState(), who = String(msg.for ?? "all"), rt = host.agents.values().next().value?.session.modelRuntime;
      const choice = msg.provider ? { provider: String(msg.provider), id: String(msg.id) } : undefined;
      if (choice && !(rt?.hasConfiguredAuth(choice.provider) && rt.getModel(choice.provider, choice.id)))
        return fail(`${choice.provider}/${choice.id} isn't usable now: ${signIn ? "connect it with /login" : "not offered by this endpoint"}`);
      if (who === "all") {
        if (!choice) return fail("Pick a model");
        s.default = choice;
      } else {
        if (!host.agents.has(who)) return fail(`No agent '${who}'`);
        s.agents = { ...s.agents };
        if (choice) s.agents[who] = choice; else delete s.agents[who];  // no model: back to the all-agents one
      }
      writeState(s);
      try {
        for (const a of host.agents.values()) await apply(a);
        host.broadcast("model", { step: "changed" });
      } catch (e) { fail(e); }
    }

    if (msg.type === "model_logout") {
      const id = String(msg.provider ?? ""), rt = await runtime(), saved = readModels();
      try {
        if ((await rt.listCredentials()).some((c) => c.providerId === id)) await rt.logout(id);
        if (id in saved.providers) {
          delete saved.providers[id];
          fs.writeFileSync(MODELS, JSON.stringify(saved, null, 2) + "\n");
        }
        await synced();
      } catch (e) { fail(e); }
    }
  });
}
