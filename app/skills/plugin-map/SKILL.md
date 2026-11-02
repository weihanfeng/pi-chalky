---
name: plugin-map
description: Find your way around your own code (the pi extensions in your code folder, the page among them) without reading whole files. Use before changing yourself, or before planning work for others that will.
---
# Getting a map of your own code

Your code folder is the one your prompt names (it holds `extensions/`). Every feature is one extension, and every
extension is one folder, `extensions/<name>/`, holding all of that feature:

| File          | What it is                                                         |
|---------------|--------------------------------------------------------------------|
| `index.ts`    | the extension itself (pi loads it); starts with a header comment    |
| `guide.md`    | its short prompt section (the part you are reading in your own prompt) |
| `README.md`   | the whole of what the guide says, read when the guide says          |
| `browser.js`  | its part of the page (the page extension loads every one it finds)  |
| `skills/`     | skills only this feature needs (its index.ts gives them to pi)      |

An extension can have other files too (`ui/` has its components, `page/` has `page.html`). The headers are the
documentation, kept with the code, so read them before the code itself.

## 1. The map: one line per extension
From your code folder:
```
for d in extensions/*/; do printf '%-24s %s\n' "$d" "$(grep -m1 '^//' "$d/index.ts" | sed 's|^// \?||' | cut -c1-140)"; done
```
Also there:
- `extensions/page/`: the page itself (`page.html`), its list of browser parts, and what serves them.
- `extensions/ui/components/*.js`: UI components, each starting with a comment line on what it is, then its
  `about` block (props, levers, example; `head -20 <file>`).
- `skills/<name>/SKILL.md`: skills about you as a whole (this one); a feature's own skills are in its folder.
- `ui/`: what you built, not code: `surfaces.json` (the surfaces' design) and `apps/<name>/`.
- The host, `server.ts` one folder up: sessions, the web server, `globalThis.chalky`. Read its header; don't edit it.

## 2. The headers of the extensions involved
```
awk '/^import /{exit} 1' extensions/swarm/index.ts     # everything above the imports
```
Read only the headers of the extensions your work touches. All of them at once is over 13,000 characters.

## 3. Then only the code you will change
Use `grep -n` to find the function, then `read` with `offset` (its first line) and `limit` for that part. A whole file can be long
(swarm's index.ts is over 16,000 characters). If you are planning work for other agents, the headers are usually
enough: let each agent read the code it owns.

## Keep the headers true
When you change what an extension provides (a tool, a route, a page message, an event, a host service), update
its header in the same change. Other agents, and you after a reload, rely on it. A new extension is a new folder
with an `index.ts` whose header starts with a one-line summary: that line is its entry in the map. After editing,
call the reload tool.
