---
name: agent-apps
description: Build an app whose members are real AI agents (a simulated board meeting, a debate, a negotiation, a panel of experts, game characters), run and shown by the app itself, in turns or all at once. Use when the user wants agents inside what you build, as opposed to agents helping you build it.
---
# Apps with real agents inside

## Two kinds of agents: keep them apart
|                   | Worker agents                   | App agents                                   |
|-------------------|---------------------------------|----------------------------------------------|
| What for          | help you build or fix the app   | are part of the app (a board member, a debater) |
| Spawn             | `spawn_agent(role)`             | `spawn_agent(role, name, app="<surface>")`    |
| Who talks to them | you (`tell`, `ask_agent`)       | the app, through `/ui/agents.js`             |
| Messages panel    | shown                           | hidden: the app shows their talk             |
| When they run     | while you build                 | each time the user runs the app              |

Don't mix them: an app agent never edits code, and a worker never plays a character. The `app` label
is what keeps app agents out of the user's messages panel and lets the app reset them.

## Why the app runs the activity, not you
Your context is large (system prompt plus everything you did while building): each of your model calls
costs all of it, often 50k tokens or more. If you relay a meeting yourself (ask the chair who's next, ask
that member, `ui_update` the transcript), every line spoken costs two or three of your calls. The app
can talk to its agents directly, and their contexts are small. So you build, fix, and answer the user;
at run time you make no calls at all.

## Steps
1. **Plan the members**: a short name each (it is the agent's name, seen in every event), and a role with
   stance and personality. End each role with: "You are a character in <app>. Answer in plain text,
   briefly, starting with [to: <name>] or [to: all]. Don't use tools." App agents have the same tools
   you have; this keeps them in character, fast, and gives the app a "to" to draw.
2. **Build the UI as an App**: `ui/apps/<name>/index.html` in your code folder (the one your prompt names, with
   `extensions/` in it), and its scripts, shown with
   `ui_render("<surface>", [{"id": "root", "component": "App", "src": "<name>/index.html"}])`.
   An App can import `/ui/agents.js`; the bridge finds the app's surface from the frame it runs in.
3. **Spawn the members once**, while building: `spawn_agent(role, name=..., app="<surface>")`, the same
   string as the surface id. In the app, check `agents.list()`: if a member is missing, show that
   instead of failing.
4. **Wire the app with `/ui/agents.js`** (read its header):
   - `send(to, text)`: ask a member. Its answer arrives as a `"message"` event: `agent` is that member,
     `role` is `"assistant"`, and there are no `tool_calls` (its final answer).
   - `on("message", fn)`: draw each answer as it arrives (speaker, the `[to: …]` target, the text).
   - `reset()`: a fresh round, members' memories empty and roles kept. Call it before each run if the
     user wants rounds to start fresh.
   - `action(name, context)`: only for what needs you, e.g. "add a member" (you spawn it).
5. **Run the activity in the app's own JavaScript**, the way the user asked:
   - In turns: one member at a time; the next speaker comes from a rule or from a chair member (ask
     it to answer "NEXT: <name>").
   - All at once: send to several members together; answers come back in any order, so draw each one
     as it arrives.
   Members only know what you send them: include the transcript so far (or its last lines) each time.
6. **Check it** with the ui-check skill: one short run, budget 2 or 3 messages (each is a real model call).

## The ask helper (copy into the app)
```js
import agents from "/ui/agents.js";
const waiting = {};  // member -> resolve() for its next final answer
agents.on("message", (ev) => {
  if (ev.role === "assistant" && !ev.tool_calls?.length && waiting[ev.agent]) {
    waiting[ev.agent](ev.content);
    delete waiting[ev.agent];
  }
});
function ask(name, text) {  // send, then wait for that member's answer
  const answer = new Promise((resolve) => (waiting[name] = resolve));
  agents.send(name, text);
  return answer;
}
// in turns:      const said = await ask(next, `${scenario}\nSo far:\n${lines.join("\n")}\nYour turn.`);
// all at once:   const said = await Promise.all(names.map((n) => ask(n, prompt)));
```
Only start asking after the user presses Start: on load, past events are replayed first, and an
answer from an earlier run must not resolve a new question.

## Record and replay
- Keep the run in the app: `[{ts, from, to, text}]` from the events. Replay draws them in `ts` order
  with play, pause and a scrubber.
- After a reload, past events replay: rebuild earlier runs from them (only your members' messages).
  A member's `"system"` message means a fresh memory, i.e. a new round began.
- Don't keep the transcript in the surface's data with `ui_update`: that is you relaying again.

## Limits
- App messages: at most 30 a minute (each is a model call); more are dropped with an `"error"` event.
  Show the run's message budget in the UI and stop when it is spent.
- At most 8 agents in all, you and any workers included.
- An agent takes one turn at a time: sending to a busy member queues the message.

## Pitfalls
- Disable Start while a run is going: a double click starts two runs.
- An answer without a `[to: …]` tag: treat it as to all.
- If the app shows nothing, the panel won't help (app agents are hidden there): check the app with
  ui-check, e.g. `eval:` the length of its transcript, and look for `"error"` events.
