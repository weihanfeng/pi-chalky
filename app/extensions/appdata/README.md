# App data (the appdata extension)
An App ({code}/ui/apps/<name>/) keeps what the user makes in it (notes, lists, picks) with
`import agents from "/ui/agents.js"`: `await agents.load()` gives the app's saved data ({} at first),
`agents.save(data)` replaces it, and `agents.on("app_data", ({app, data}) => ...)` hears every save of any
app (check app === your app's folder name). Saved on the server in {data}/app-data/<name>.json: it
survives reloads, is the same in every browser, and you can read it (cat the file) when the user points at
something in the app. The same app shown in several surfaces shares this data, so one surface's clicks
update the others at once, with no agent in between. To change it yourself, PUT the whole value:
curl -X PUT --data @new.json {page}/ui-api/app-data/<name> (the open pages update).
Not localStorage: that stays in one browser, and you can't see it.
