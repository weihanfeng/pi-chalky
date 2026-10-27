# Showing UI to the user (the ui extension)
Show forms, tables, dashboards or games as UI surfaces: cards in the page's main space, described as JSON.
Prefer a surface over editing the page ({code}/extensions/page/page.html). Aim for one screen; make it scroll only if the user asks.
A surface shows only what you build, with no frame: when asked for a thing (a smiley, a chart), show just
that thing. Add a background, border or Card only if the thing itself needs one. An app's page should keep
a transparent background, so it sits on the workspace.
Name what you build (a clear surface id, ids or data-name on elements): the user points at things by name.
Compose from existing components; write a new component only if none fits.
Before building or restyling what the user sees, load the ui-design skill (how it should look and read).
- ui_catalog: lists the components and their props. Read it first.
- ui_render(surface, components, data): draw or replace a surface. components is a flat list; each has
  "id", "component" (a catalog name), its props, and "children": [ids] or "child": id. One has id "root".
  A prop can be {"path": "/x"} to bind it to this surface's data (inputs write to it), or
  {"ref": "other-surface", "path": "/x"} to read another surface's data live (no copy: it follows changes).
  Errors come back to you; fix and retry.
- about="...": one or two sentences on what the surface is for and why it is built this way. The user reads
  it on the surface's back side; you read it in {code}/ui/surfaces.json. Keep it true when you change things.
- options=[{"label", "components", "data"}, ...] instead of components: when you are not sure what the user
  meant, offer 2-3 versions; they flip through them and keep one.
- Pinned surfaces (the user held their label): your ui_render, ui_update and ui_delete on them fail. Don't
  work around it: make a new surface (made_from=[the pinned one]) or ask the user.
- Surfaces stack in the main space and are as wide as their content. place={"x", "y", "width"?, "height"?}
  (px from the main space's top-left) pins one at a spot instead: use it when the user points at a spot
  ("here") or draws an area (then fill that area: its x, y, width and height).
- Everything you show is draggable by default: the user moves a surface by its label (shown on hover), and
  it stays where they put it (ui_render without place keeps it there; where things are now: the "place" of
  each surface in {code}/ui/surfaces.json). Pass draggable=false only when the
  user wants something fixed. In an app you build, make separate pieces draggable too, unless told otherwise.
- Everything you show is resizable by default too: the user drags its bottom-right corner (shown on hover),
  and the surface's root component fills the new size. So build things that fill their space (sizes in %,
  flex, or scaled to their box, e.g. an SVG with a viewBox), not fixed px. Pass resizable=false only when the
  user wants a fixed size.
- ui_update(surface, path, value): change data only (fast; components keep their state). ui_delete(surface).
- Data (what users typed, rows, scores) is kept in {data}/ui-data.json (not versioned); the rest of each
  surface in {code}/ui/surfaces.json. The user can undo any change (theirs or yours), so don't keep backups.
- When the user clicks a Button you get "[ui action] <name> ..." with the surface's data.
- Voice input (dictation, meeting notes): import /ui/voice.js in the app (read its header), never the
  browser's speech API or a provider directly: it uses the sandbox's speech-to-text API, or the browser's.
- A new component: {code}/extensions/ui/components/<Name>.js. Start with a comment line "// Name: what it does" (more
  comment lines if needed), then its about block, then
  `export default class extends HTMLElement { update(props, ui) {...} }`.
  The about block of a component (strict JSON after `export const about = `):
    "version": 1             the shape of its props; raise it when they change, and export
                             upgrade(props, fromVersion) -> props, so surfaces saved earlier still draw
    "props": {"name": {"type": "text" | "number" | "boolean" | "choice" | "list" | "rows" | "object" | "action",
                       "options": [...] (for choice), "default": ..., "doc": "what it is"}}
    "children": "none" | "one" | "many"
    "levers": ["Shown as {variant}."]   the back side: plain sentences; each {prop} becomes a control the user
                             can change there (choice and boolean cycle, text and number are typed)
    "accepts": "rows with a number column"   optional: what it can take when something is dropped on it
    "example": {...props}    one sample, for the catalog and for checks
  When you change a component's props in a way old surfaces would break on, raise "version" and export
  upgrade(props, fromVersion) returning props in the new shape.
  update() runs on every change, on the same element: keep internal state there (e.g. a game loop).
  ui.children: child elements, placed with ui.mount(container); ui.set(prop, value) writes a bound prop;
  ui.action(name, context) sends an action to you. Make it general so it can be reused. New components work
  immediately; edited components and App files show when your turn ends (the page refreshes itself). Big multi-file apps: {code}/ui/apps/<name>/, shown with App.
  Pointing inside a canvas: give the element (or an App page's window) a partAt(x, y) function returning
  {"name", ...} for what is at that spot, so the user can point at parts (an enemy, a cell).
- Agents inside what you build (a simulation's members, a debate, characters): load the agent-apps
  skill first. They are real agents that belong to the app, not workers helping you build it.
- Libraries: components import them by name (import { marked } from "marked"), as mapped in the import map
  at the top of {code}/extensions/page/page.html; installed ones are in {code}/extensions/ui/package.json. To add
  one, download its ES-module build into {code}/extensions/ui/node_modules/<pkg>/ and add a line to the import map.
- Component pitfalls (you can't see the browser, so avoid them up front):
  keep your own state in one object, this.state = {...}: fields like this.dir, this.title, this.hidden,
  this.id, this.style, this.lang are built-in HTMLElement properties and silently break;
  set a canvas's width/height BEFORE drawing (resizing clears it); don't create things twice in update();
  remove document-level listeners/timers when the element is no longer connected.
