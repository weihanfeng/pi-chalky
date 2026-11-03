---
name: design
description: How to make what you build for the user look good and read clearly - charts, diagrams, game art, dashboards, one look across cards. Use for those, for a restyle, or for a look the user asks for; the app README has the basics a usual app needs.
---
# Designing what the user sees

What you build fills the user's screen, and the user then points at it and marks it up.
So it must look like it belongs on the page, and each piece must be a clear thing to point at.
Precedence: the user's own words, then the page's existing look, then your choices.

## 1. Fit the page
The page is light, glassy and quiet (Apple-like): soft gradient background, translucent white glass,
thin edges, system font. Match it unless the user asks for another look.
- Use the page's tokens instead of literal colours (they are defined on the page and reach blocks;
  apps in a frame copy the values they need):
  `--text #1d1d1f`, `--soft rgba(29,29,31,.72)`, `--muted rgba(60,60,67,.55)`, `--accent #0071e3`,
  `--danger #e5484d`, `--line rgba(0,0,0,.06)`, `--glass rgba(255,255,255,.45)`,
  `--glass-strong rgba(255,255,255,.7)`, `--edge rgba(255,255,255,.75)`, `--radius 16px`.
- The built-in blocks (Panel, Button, Table, Text, TextField, Markdown) already use these tokens;
  prefer them, and style your own blocks the same way.
- Font: inherit the page's system font. Use a Google Font only when the subject calls for it
  (a pixel-art game, a poster), and always give a fallback stack.
- Show just the thing: no frame, card or background around it unless it needs one. Transparent app backgrounds.
- A user-requested look (pixel art, neon, paper) wins. Commit to it fully inside that card,
  and keep the rest of the page as it is.

## 2. Ground it in the subject
- Pick one concrete job for each card. Use real content, never lorem ipsum.
- Take at least one detail from the subject's own world: its real units, terms, conventions
  (a chess clock shows mm:ss; a kanban card has an owner and a state).
- Structure must mean something: number things only when order matters; a divider only between real groups.

## 3. Lay it out
- Group siblings with flex or grid and `gap`, not per-element margins.
- Make repeated things consistent: same padding, edges and baselines on every card in a row;
  a recurring element sits in the same place on each.
- Let content set the height. Text that can outgrow its box wraps or scrolls inside it; clipped text is a bug.
- `font-variant-numeric: tabular-nums` wherever digits line up.
- Borders, fills, radius and shadow mark something as a separate object. Use them on the one
  element that needs it, not on every block.
- Keep it complete at rest: visible when it loads, never left at `opacity: 0` waiting for an animation.
- A tool opens in a working state: sample rows or a loaded example (marked as such), not an empty shell.

## 4. Type and words
- One type scale; keep to it. Running text near 65 characters wide. Headings `text-wrap: balance`.
- Small uppercase labels get a little letter-spacing.
- Name things by what the user recognises, not how it's built. Buttons say exactly what happens
  ("Start round", then "Round 2 started"). Errors say what went wrong and how to fix it. Short, plain sentences.

## 5. Avoid the generic AI look (unless the user asks for it)
Cream background with a serif and terracotta accent; near-black with one acid-green pop;
purple-to-blue gradient heroes; emoji as section markers; everything centred; the same rounded
shadowed card on everything; a coloured accent bar down the side of cards.

## 6. Dashboards and tools
They are scanned and operated, not read top to bottom.
- Summary before detail. Show state in form as well as numbers (a pill, a chip, a stripe),
  so what needs attention is visible at a glance.
- Status colours (good / warning / critical) are separate from the accent, and always come with
  an icon or a word, never colour alone.
- Interactive things look interactive; keyboard focus is visible.

## 7. Charts
Pick the form first, colour last.
- The data's job picks the chart: magnitude (bar), change over time (line), share (stacked bar),
  one headline number (a stat, not a chart). Sometimes the answer is a sentence or a table.
- Colour by job: identity = distinct hues in a fixed order (never cycled, and a hue follows its
  entity even when filters change); magnitude = one hue light to dark; polarity = two hues with a grey middle.
  Never a rainbow. More than about 8 series: fold into "Other" or split into small charts.
- One y-axis. Never two scales on one chart; use two charts instead.
- Thin marks: 2px lines, bars with a 2px gap, markers at least 8px. Faint grid, quiet axes.
- Place marks, ticks and labels with one scale; every tick names a value the chart reaches.
- Two or more series: a legend, plus direct labels when there are 4 or fewer. Label a few points, not every one.
- Text uses text colours (`--text`, `--muted`), never the series colour.
- Add hover: a tooltip per bar/dot, a crosshair on lines. Hit targets bigger than the mark.

## 8. Diagrams
Draw only when a picture shows a mechanism faster than a sentence: what flows where, which parts
talk, what changes between two options.
- Draw the mechanism, not its name: the path a request takes, the boundary crossed, the edge that appears or disappears.
- Comparing options: draw the difference side by side, so the user can point at what they are choosing between.
- Label every arrow (`writes`, `polls every 30s`). Short labels (1-3 words); sentences go in a caption.
- Inline `<svg viewBox="0 0 W H">` scaled by CSS (`max-width:100%; height:auto`). Strokes and text in
  `currentColor`; one literal hue only for the element that carries the point. Arrowheads via `<marker>`.
  Text about 11-13px. Align to a grid with even gaps. Give every shape an explicit fill.
- Wrap in `<figure>` with a `<figcaption>` that states the claim.

## 9. Make it easy to reshape
The user changes what you build by hand (pins, levers on the back side, combining, undo), so build for that.
- One clear thing per card, with a name the user would say (`lunch-orders`, not `card3`).
- Write `about`: what it is for and any decision a later change should respect ("drinks are not counted").
- Put what changes in data (rows, scores, settings) and the look in blocks: data changes are instant
  for the user and never need you.
- Read other cards' data with `{"ref": "<card>", "path": "/..."}` instead of copying it, so it stays live.
- A block you write: its about block lists every prop with a type, and `levers` for the few a user
  would want to change (a size, a mode, a label), written as plain sentences.

## 10. One look
What the user builds over time should look like one hand made it: a garden and the wrestler standing
in it share a palette, a way of shading and a level of detail.
- Before drawing something new, look at what is already there (a screenshot, and the code of the
  cards it sits beside). Match its palette, shading, line weight and detail. Read their code and
  reuse their colours and helpers rather than redrawing them from memory.
- Keep a small palette: a ground, a main colour for shapes, an ink for words, and one accent for the
  one thing to look at. Mix shades from those (`color-mix(in srgb, <main> 70%, <ground>)`, lighter and
  darker) rather than inventing new colours. Many shades of a few colours look designed; many
  unrelated colours look accidental.
- Keep the palette in one place the code can reuse (CSS variables, a small shared module), so a
  later change touches one spot.
- Readable first: text needs strong contrast with what is behind it (about 4.5:1; shapes about 3:1;
  compute it if unsure). Colours that differ in hue but are equally bright blur together: vary the lightness.
- Taste: start from the subject's own world (a temple garden, a night market, a ledger). Tone the
  extremes (a warm off-white, a deep ink, rarely pure white or black). One accent used sparingly beats
  three. Neon, glows, gloss and full saturation everywhere look machine-made unless the subject calls for them.
- Games and 3D: the same idea as art direction, not exact colours. One sky or fog colour and one light
  colour across the scene hold it together, however many materials it has; the accent marks what the
  player should notice; the HUD and menus use the palette like any card.
- A default, not a rule: when the user asks for another look, or a piece clearly needs its own world
  (a dark space game beside a light garden), give it one, commit to it, and say so in its `about`.

## 11. Check it
Load browser-check and look at a screenshot: overlaps, clipped text, labels colliding, things outside their box.
Fix what you see once, then stop polishing; the user will point at what they want changed.
