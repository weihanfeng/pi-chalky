---
name: extension-map
description: Find your way around your own code (the pi extensions in your agent folder, the page among them) without reading whole files. Use before changing yourself, or before planning work for others that will.
---
# Getting a map of your own code

Your agent folder ({agent} in your prompt) holds `extensions/`. Every feature is one extension, and every extension
is one folder, `extensions/<name>/`, named after the one thing it is (card, board, note, team...), holding all of it:

| File          | What it is                                                         |
|---------------|--------------------------------------------------------------------|
| `index.ts`    | the extension itself (pi loads it); starts with a header comment    |
| `guide.md`    | its short prompt section (found by itself: the prompt extension adds every one) |
| `README.md`   | the whole of what the guide says, read when the guide says          |
| `browser.js`  | its part of the page (found by itself: the page extension loads every one) |
| `skills/`     | skills only this feature needs (its index.ts gives them to pi)      |

An extension can have other files too (`card/` has its `blocks/`, `page/` has `page.html`, `model/` has
`login.ts`). The headers are the documentation, kept with the code, so read them before the code itself.

## The naming rule
Everything an extension adds carries its name: tools `<name>_<verb>` (card_show, note_done, team_ask), page
messages `<name>_<verb>` (card_move, history_undo), page events `<name>` (card, history), routes `/<name>/...`
(/card/all, /note/all), its data in {data} (`<name>.json` or `<name>/`), and what it offers others as
`host.api.<name>` (host.api.card.watch, host.api.team.send). So from any one name you can find the rest.

## 1. The map: one line per extension
From your agent folder:
```
for d in extensions/*/; do printf '%-24s %s\n' "$d" "$(grep -m1 '^//' "$d/index.ts" | sed 's|^// \?||' | cut -c1-140)"; done
```
Also there:
- `extensions/page/`: the page itself (`page.html`), its list of browser parts, and what serves them.
- `extensions/card/blocks/*.js`: the blocks cards are built from, each starting with a comment line on what it
  is, then its `about` block (props, levers, example; read its first 20 lines).
- `skills/<name>/SKILL.md`: skills about you as a whole (this one); a feature's own skills are in its folder.
- {built}: what you made for the user, not code: `card.json` (the cards), `board.json`, `apps/<name>/`.
- The host, `server.ts` (its path is in your prompt): the four folders, sessions, the web server, the version
  history's rule, `globalThis.chalky`. Read its header; don't edit it.

## 2. The headers of the extensions involved
```
awk '/^import /{exit} 1' extensions/team/index.ts     # everything above the imports
```
Read only the headers of the extensions your work touches. All of them at once is over 13,000 characters.

## 3. Then only the code you will change
Use `grep -n` to find the function, then `read` with `offset` (its first line) and `limit` for that part.
A whole file can be long (team's index.ts is over 15,000 characters). If you are planning work for other agents,
the headers are usually enough: let each agent read the code it owns.

## Keep the headers true
When you change what an extension provides (a tool, a route, a page message, an event, a host service), update
its header in the same change, and follow the naming rule. Other agents, and you after a reload, rely on it. A new
extension is a new folder with an `index.ts` whose header starts with a one-line summary: that line is its entry
in the map. After editing, call the reload tool.
