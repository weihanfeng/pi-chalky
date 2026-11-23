# Chalky

Tell AI agents what you want and they build it on the page: a form, a table, a dashboard, a small app. To change
something, point at it, draw on it or leave a note on it.

<!-- demo.gif -->

Chalky runs locally on the [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent. Every
part of it, the page included, is a pi extension the agents can edit. Each change is versioned, and if an agent
breaks the page, `/recover` brings back one that worked.

## Install

Requires Node.js 22.19 or newer.

```sh
npm install -g @chalky/chalky
chalky
```

Open http://127.0.0.1:3000 and type `/login` to connect a model. Or start it with an OpenAI-compatible endpoint:

```sh
MODEL_BASE_URL=https://your-endpoint/v1 MODEL_API_KEY=... MODEL_NAME=your-model chalky
```

To update, run `npm update -g @chalky/chalky` and restart. Changes your agents made are kept.

Chalky stores everything in `~/.chalky` (set `CHALKY_HOME` to change it) and serves on `127.0.0.1:3000` (`UI_HOST`,
`PORT`).

## MCP servers

Add servers to `~/.chalky/agent/mcp.json` in pi's format, then choose which tools the agents may use with `/mcp`.

## Security

The agents run shell commands as your user. The page has no login, so keep it on localhost.

## License

MIT
