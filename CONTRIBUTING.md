# Contributing to MCP Bridge

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
cp mcpbridge.config.example.json mcpbridge.config.json
```

## Architecture (v2.1)

Single file (`bridge-server.js`) with:

- **CONFIG** - Retry, cache, compaction settings
- **Result Store** - In-memory compacted results (10 min TTL)
- **Tool Cache** - Schema cache (5 min TTL)
- **Connection Pool** - Lazy connections with retry
- **8 Meta-Tools** - list_servers, list_mcp_tools, get_tool_schema, call_mcp_tool, get_result, list_results, check_server_health, get_bridge_stats

## Key Concepts

### Lazy Schema Loading
- `list_mcp_tools` returns tool NAMES only (95% context savings)
- `get_tool_schema` fetches ONE tool schema on-demand

### Result Compaction
- Results >2KB or >20 items auto-compact
- Returns preview + result_id
- Full data via `get_result(id)`

### Retry Logic
- Exponential backoff: 1s, 2s, 4s
- Jitter prevents thundering herd
- Auto-reconnect on failures

## Adding a Meta-Tool

1. Add definition to `TOOLS` array
2. Add handler in `CallToolRequestSchema` section
3. Update README.md and AI_PROMPT.md

## Adding Server Examples

Add to `mcpbridge.config.example.json`:
```json
"my-server": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@org/mcp-server"],
  "description": "Description here",
  "enabled": false,
  "env": { "API_KEY": "YOUR_API_KEY" }
}
```

Never commit real credentials!

## Pull Request Guidelines

1. Fork and branch from `main`
2. Validate: `node --check bridge-server.js`
3. Test with real MCP servers if possible
4. Update docs for user-facing changes
5. Submit PR with clear description

## Code Style

- Single file architecture
- ES modules (import/export)
- Async/await
- Log to stderr: `console.error('[mcpbridge] ...')`
- Helpful error messages with hints

## Reporting Issues

Include: Node.js version, OS, bridge version, steps to reproduce, full error.

## Ideas for Future

- File-based result storage
- WebSocket transport
- Config hot-reload
- Per-server settings

## License

By contributing, you agree to the MIT License.