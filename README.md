# Chalky

Chalky is a workspace where AI agents build what you see. You say what you want, the agents put a working
first version on the page (forms, tables, dashboards, small apps), and then you point at things on it, draw on
it and leave notes, and they change exactly that. The conversation is a side panel; what they build fills the
screen.

The agents run on [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Everything they are made of
is pi extensions they can edit themselves, the page included. Every change is versioned, and
`http://127.0.0.1:3000/recover` takes you back to a version that worked if an agent breaks the page.

## Install and run

Needs Node.js 22.19 or newer and an OpenAI-compatible model endpoint (an OpenAI-style `/v1`, a LiteLLM proxy, a
local server).

```sh
npm install -g @chalky/chalky
MODEL_BASE_URL=https://your-endpoint/v1 MODEL_API_KEY=... MODEL_NAME=your-model chalky
```

Then open http://127.0.0.1:3000.

| Variable | |
|---|---|
| `MODEL_BASE_URL` | the endpoint, up to `/v1` |
| `MODEL_API_KEY` | its key |
| `MODEL_NAME` | the model (default: `default`) |
| `CHALKY_HOME` | where Chalky keeps its things (default: `~/.chalky`) |
| `UI_HOST` | the address to serve on (default: `127.0.0.1`, this machine only) |
| `PORT` | the port to serve on (default: `3000`) |

## Where things are

`~/.chalky` (or `CHALKY_HOME`) holds:

- `agent/`: what the agents are: their prompt, settings and extensions (the page among them), copied from the
  package on the first run. The agents edit it. A newer version of the package doesn't overwrite it.
- `built/`: what the agents made for you: the cards on your boards, and the apps they wrote.
- `data/`: what is kept while running: conversations, what you typed into cards and apps, notes, undo history.
- `workspace/`: the agents' working folder; `workspace/drops/` holds your files.

`agent/` and `built/` share one version history: each agent turn that changes them is saved, and a rollback puts
both back. A home from before this layout (`app/`, `state/`) is moved into it on the first start; the old code
stays in `app-before-reorg/`.

## MCP servers

Tools from MCP servers go in `~/.chalky/agent/mcp.json`, in pi's format (stdio or streamable HTTP; see pi's
`docs/mcp.md`). Type `/mcp` on the page to choose which servers and tools the agents may use. Keep secrets in
environment variables and refer to them as `${NAME}` in `headers` or `env`.
