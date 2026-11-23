# Chalky

Tell AI agents what you want and they build it on the page: a form, a table, a dashboard, a small app. To change
something, point at it, draw on it or leave a note on it.

<!-- demo.gif -->

## Install

Requires Node.js 22.19 or newer.

```sh
npm install -g @chalky/chalky
chalky
```

Open http://127.0.0.1:3000 and type `/login` to sign in with an account you already have (ChatGPT, Claude, GitHub
Copilot and others) or an API key.

To update, run `npm update -g @chalky/chalky` and restart. Changes your agents made are kept.

## MCP servers

Add servers to `~/.chalky/agent/mcp.json`, then choose which tools the agents may use with `/mcp`.

## Security

The agents run shell commands as your user. The page has no login, so keep it on localhost.

## License

MIT. Built on [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
