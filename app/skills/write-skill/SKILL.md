---
name: write-skill
description: How to write or improve a skill (SKILL.md format, folder layout, a good description). Use when you want to save a method you worked out so you and other agents can reuse it, or when a skill is listed as broken.
---
# Writing a skill

## When a skill is worth it
- You worked out a method that wasn't obvious, and the task will come up again (here or in later runs).
- You hit a pitfall that cost time. Save the fix, not the story.
- Not for facts about the current project: those belong in the project's own files (e.g. CONTRACTS.md).
- One skill per kind of task. If one already covers it, improve that one instead of adding another.

## Layout
```
skills/<name>/    in your code folder (the one your prompt names, with extensions/ in it)
  SKILL.md        required: front matter + instructions
  scripts/        optional: code to run (node or bash; python only if it is installed)
  references/     optional: longer docs, read only when needed
  assets/         optional: templates, data files
```
A skill that only one feature needs goes in that extension's folder instead, `extensions/<name>/skills/<skill>/`
(as `extensions/ui/skills/`), and its `index.ts` gives the folder to pi:
`pi.on("resources_discover", () => ({ skillPaths: [path.join(import.meta.dirname, "skills")] }))`.

## SKILL.md
```markdown
---
name: csv-report
description: Turns a CSV file into a summary report with totals per column. Use when the user gives a CSV and asks for a summary, report or totals.
---
# CSV report
1. Run `node scripts/report.mjs <file.csv>` (paths are relative to this skill's folder) to get the totals.
...
```
- `name`: exactly the folder's name. Lowercase letters, digits and single hyphens; at most 64 characters.
- `description`: at most 1024 characters. Say what it does AND when to use it, with the words a matching
  task would contain. Agents decide whether to load the skill from this line alone, so it matters most.

## Writing the body
- Write steps in the imperative ("Run …", "Check …"), with a short example of input and output.
- Explain why a step matters instead of shouting MUST: an agent that understands the reason handles
  cases you didn't foresee. Keep it general, not tied to the one case you just solved.
- Work that must come out the same every time (parsing, checks, setup) goes in a script, not in prose.
  Run the script once before saving it.
- Keep SKILL.md under ~500 lines. Move long material to references/ and say when to read each file.
  A reference over ~300 lines gets a table of contents at the top.
- If the skill covers variants (e.g. several frameworks), keep the shared workflow in SKILL.md and one
  reference per variant (references/react.md, references/vue.md), so only the relevant one is read.
- Refer to files by paths relative to the skill folder.
- No surprises: a skill does what its description says. Never put secrets (keys, passwords) in one.

## After writing
- Call the reload tool: your skill list loads again when your turn ends, and the new skill shows in your prompt
  (name, description and path; you read SKILL.md with read). If it doesn't show, its front matter is wrong.
- Read it once as a newcomer would: is anything only clear because you just did the work?
- Skills are shared, but another agent only sees a new skill after it reloads (tell it to call reload).
  Tell the user what you added.
