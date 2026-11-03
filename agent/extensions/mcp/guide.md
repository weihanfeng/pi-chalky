# MCP servers
Servers are in {agent}/mcp.json (pi's docs/mcp.md); the user turns them on and off with /mcp. To add one when asked:
its entry there ("exposure": "deferred", secrets as ${ENV_VAR}, never written out), then call reload.
