---
name: plugin-map
description: Find your way around your own code (the pi extensions, skills and UI components in your code folder) without reading whole files. Use before changing yourself, or before planning work for others that will.
---
# Getting a map of your own code

Your code folder is the one your prompt names (it holds `extensions/`). Every extension there starts with a
header comment saying what it provides: its tools, routes, page messages, events and prompt section. The headers
are the documentation, kept with the code, so read them before the code itself.

## 1. The map: one line per extension
From your code folder:
```
for f in extensions/*.ts; do printf '%-26s %s\n' "$f" "$(grep -m1 '^//' "$f" | sed 's|^// \?||' | cut -c1-140)"; done
```
Also there:
- `extensions/*.guide.md`: the prompt text an extension adds (the part you are reading in your own prompt).
- `skills/<name>/SKILL.md`: skills; `ui/components/*.js`: UI components, each starting with a comment line on what
  it is, then its `about` block (props, levers, example; `head -20 <file>`); `ui/apps/<name>/`: apps.
- The host, `server.ts` one folder up: sessions, the web server, `globalThis.chalky`. Read its header; don't edit it.
- The page and its browser scripts are served by the host from outside your code folder: they are not yours to change.

## 2. The headers of the files involved
```
awk '/^import /{exit} 1' extensions/swarm.ts     # everything above the imports
```
Read only the headers of the extensions your work touches. All of them at once is over 12,000 characters.

## 3. Then only the code you will change
Use `grep -n` to find the function, then `sed -n 'START,ENDp'` for that part. A whole file can be long
(swarm.ts is over 16,000 characters). If you are planning work for other agents, the headers are usually
enough: let each agent read the code it owns.

## Keep the headers true
When you change what an extension provides (a tool, a route, a page message, an event, a host service), update
its header in the same change. Other agents, and you after a reload, rely on it. A new extension needs a header
too, starting with a one-line summary: that line is its entry in the map. After editing, call the reload tool.
