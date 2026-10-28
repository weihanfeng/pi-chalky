// Bridge from an app ({code}/ui/apps/<name>/, shown by the App component) to the agents. An app imports it:
//   import agents from "/ui/agents.js";
//   agents.send(to, text)         a message to an agent, from "app"; its answer comes as a "message" event
//                                 (role "assistant", no tool_calls). Each one is a model call: limited per minute.
//   agents.action(name, context)  an action for the agent that owns this app's surface, like a Button
//   agents.on(type, fn)           events as the page gets them, past ones first (replayed on connect), then live:
//                                 "message" {agent, role, content, tool_calls, ts}: every message of every agent,
//                                 incl. its ask_agent / tell calls (who talks to whom); "status" {agents}: who is busy
//   agents.list()                 {name: {role, app, state, doing, queued}}, from the latest "status" event
//   agents.reset()                empty the memories of this app's agents (spawned with app=<this surface>),
//                                 roles kept: a fresh round. Refused (an "error" event) while one is busy.
//   agents.load()                 this app's saved data ({} at first), from the appdata plugin (on the server)
//   agents.save(data)             replace it; every page and app frame then gets "app_data" {app, data}, so
//                                 the same app in other surfaces updates (check ev.app === agents.app)
//   agents.app                    this app's name: its folder in {code}/ui/apps
// It opens its own WebSocket to /ws, the page's protocol (the page extension).
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
const open = new Promise((resolve) => ws.addEventListener("open", resolve));
const listeners = {};
let status = {};

ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === "status") status = ev.agents;
  for (const fn of listeners[ev.type] || []) fn(ev);
};

// In the versions plugin's screenshot (/?shot) the app is only looked at: send nothing, no model calls.
const shot = new URLSearchParams(window.top.location.search).has("shot");
const post = async (obj) => { if (shot) return; await open; ws.send(JSON.stringify(obj)); };
const app = location.pathname.split("/")[3];  // /ui/apps/<name>/...
const store = `/ui-api/app-data/${app}`;
// the surface this app is shown in (the App component's frame sits inside it on the page)
const surface = () => window.frameElement?.closest("[data-surface]")?.dataset.surface;

export default {
  send: (to, text) => post({ type: "app_message", to, text }),
  action: (name, context = {}) => post({ type: "ui_action", surface: surface(), component: "app", name, context }),
  on: (type, fn) => (listeners[type] ??= []).push(fn),
  list: () => status,
  reset: () => post({ type: "app_reset", surface: surface() }),
  app,
  load: async () => (await fetch(store, { cache: "no-store" })).json(),
  save: async (data) => { if (!shot) await fetch(store, { method: "PUT", body: JSON.stringify(data) }); },
};
