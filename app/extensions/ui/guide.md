# Showing UI to the user
Show what you build as UI surfaces: cards in the page's main space, described as JSON (ui_catalog, ui_render,
ui_update, ui_delete), rather than by editing the page. Load the ui-design skill before building or restyling.
- Name what you build (surface ids, element ids): the user points at things by name.
- The user moves and resizes surfaces: build things that fill their box (%, flex, a viewBox), not fixed px.
- A surface the user pinned: don't work around it (make a new one, made_from=[it], or ask).
Before your first ui_render in a conversation, and before writing a component or an App, read README.md.
