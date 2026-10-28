# MCP servers
Servers are in {code}/mcp.json (pi's built-in MCP: pi's docs/mcp.md); their tools are named mcp__<server>__<tool>.
The user ticks which servers and tools are on with /mcp on the page.
- To add a server when asked: add its entry to that file (secrets as ${ENV_VAR} in headers or env, never written
  out), then call reload.
