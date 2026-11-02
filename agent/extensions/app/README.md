# Apps (the app extension)
An app is a page you write in {built}/apps/<name>/ (index.html and its files), shown on a card:
card_show(card=<id>, app=<the full path of its index.html>). It is served at {page}/built/apps/<name>/.
- Data: an app keeps what the user makes in it (notes, lists, picks) with `import agents from "/app/agents.js"`:
  `await agents.load()` gives the app's saved data ({} at first), `agents.save(data)` replaces it, and
  `agents.on("app_data", ({app, data}) => ...)` hears every save of any app (check app === agents.app, its folder
  name). Saved on the server in {data}/app/<name>.json: it survives reloads, is the same in every browser, and
  you can read it (cat the file) when the user points at something in the app. The same app on several cards
  shares this data, so one card's clicks update the others at once, with no agent in between. To change it
  yourself, PUT the whole value: curl -X PUT --data @new.json {page}/app/data/<name> (the open pages update).
  Not localStorage: that stays in one browser, and you can't see it.
- Agents: agents.send(to, text) messages an agent (a model call: limited per minute), agents.action(name,
  context) wakes the agent that owns the app's card, agents.on("message", fn) shows what the agents say. Read the
  header of {agent}/extensions/app/agents.js. Agents that belong to the app (a simulation's members, characters):
  load the app-agents skill first.
