// Bridge from an app ({built}/apps/<name>/, shown on a card) to the agents. An app imports it:
//   import agents from "/app/agents.js";
//   agents.send(to, text)         a message to an agent, from "app"; its answer comes as a "message" event
//                                 (role "assistant", no tool_calls). Each one is a model call: limited per minute.
//   agents.action(name, context)  an action for the agent that owns this app's card, like a Button
//   agents.on(type, fn)           events as the page gets them, past ones first (replayed on connect), then live:
//                                 "message" {agent, role, content, tool_calls, ts}: every message of every agent,
//                                 incl. its team_ask / team_tell calls (who talks to whom); "status" {agents}: who is busy
//   agents.list()                 {name: {role, app, state, doing, queued}}, from the latest "status" event
//   agents.reset()                empty the memories of this app's agents (spawned with app=<this card>),
//                                 roles kept: a fresh round. Refused (an "error" event) while one is busy.
//   agents.load()                 this app's saved data ({} at first), kept by the app extension (on the server)
//   agents.save(data)             replace it; every page and app frame then gets "app_data" {app, data}, so
//                                 the same app on other cards updates (check ev.app === agents.app)
//   agents.app                    this app's name: its folder in {built}/apps
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

// In the version extension's screenshot (/?shot) the app is only looked at: send nothing, no model calls.
const shot = new URLSearchParams(window.top.location.search).has("shot");
const post = async (obj) => { if (shot) return; await open; ws.send(JSON.stringify(obj)); };
const app = location.pathname.split("/")[3];  // /built/apps/<name>/...
const store = `/app/data/${app}`;
// the card this app is shown on (its frame sits inside the card on the page)
const card = () => window.frameElement?.closest("[data-card]")?.dataset.card;

export default {
  send: (to, text) => post({ type: "app_message", to, text }),
  action: (name, context = {}) => post({ type: "card_action", card: card(), block: "app", name, context }),
  on: (type, fn) => (listeners[type] ??= []).push(fn),
  list: () => status,
  reset: () => post({ type: "app_reset", card: card() }),
  app,
  load: async () => (await fetch(store, { cache: "no-store" })).json(),
  save: async (data) => { if (!shot) await fetch(store, { method: "PUT", body: JSON.stringify(data) }); },
};
