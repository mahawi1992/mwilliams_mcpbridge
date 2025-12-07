# MCP Bridge - Context Engineering for AI Agents

**Reduce your MCP context usage by 99%** 🚀

MCP Bridge consolidates multiple MCP servers behind a single, intelligent interface. Instead of loading 271+ tool schemas into your AI's context window, you get 8 meta-tools with lazy schema loading.

## The Problem

Without MCP Bridge:
- 12 MCP servers × ~20 tools each = 240+ tool schemas in context
- Each schema ~500 bytes = **~120KB of context wasted**
- LLM performance degrades as context fills

With MCP Bridge:
- 8 meta-tools = ~2KB base context
- Lazy schema loading = fetch only what you need
- Result compaction = large results stored externally

**Result: 99%+ context reduction**

## Features

- **🗜️ Result Compaction** - Large results (>2KB) automatically stored, returns preview + reference
- **📦 Lazy Schema Loading** - Only fetch schemas for tools you're about to use
- **🔄 Retry Logic** - Exponential backoff with jitter for reliability
- **💾 Tool Caching** - 5-minute TTL for tool schemas
- **🏥 Health Checks** - Monitor all server connectivity
- **📊 Bridge Stats** - Memory usage, cache stats, uptime

## Installation

```bash
# Clone the repository
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge

# Install dependencies
npm install

# Copy example config
cp mcpbridge.config.example.json mcpbridge.config.json

# Edit config with your MCP servers
nano mcpbridge.config.json
```

## Setup

### Claude Code (CLI)

**Option 1: CLI Command (Recommended)**
```bash
claude mcp add mcp-bridge -- node /path/to/mwilliams_mcpbridge/bridge-server.js
```

**Option 2: Global Config (`~/.claude.json`)**
```json
{
  "mcpServers": {
    "mcp-bridge": {
      "command": "node",
      "args": ["/path/to/mwilliams_mcpbridge/bridge-server.js"]
    }
  }
}
```

**Option 3: Project Config (`.mcp.json` in project root)**
```json
{
  "mcpServers": {
    "mcp-bridge": {
      "command": "node",
      "args": ["/path/to/mwilliams_mcpbridge/bridge-server.js"]
    }
  }
}
```

After setup, verify with:
```bash
claude mcp list
```

### Claude Desktop

Add to config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-bridge": {
      "command": "node",
      "args": ["/path/to/mwilliams_mcpbridge/bridge-server.js"]
    }
  }
}
```

Restart Claude Desktop after changes.

### Cursor / Other MCP Clients

Most MCP clients use similar JSON configuration:
```json
{
  "mcpServers": {
    "mcp-bridge": {
      "command": "node",
      "args": ["/path/to/mwilliams_mcpbridge/bridge-server.js"]
    }
  }
}
```

## Usage

### 1. List Available Servers
```javascript
list_servers()
// → { servers: ["supabase", "clerk", "twilio", ...], count: 12 }
```

### 2. List Tools (Names Only - Minimal Context)
```javascript
list_mcp_tools("supabase")
// → { tools: ["query", "insert", "update", ...], tool_count: 29 }
// Only ~400 bytes instead of ~8KB!
```

### 3. Get Schema for ONE Tool
```javascript
get_tool_schema("supabase", "execute_sql")
// → { tool: "execute_sql", inputSchema: { ... } }
// Only fetch what you need!
```

### 4. Call Any Tool
```javascript
call_mcp_tool("supabase", "execute_sql", { 
  project_id: "xxx", 
  query: "SELECT * FROM users" 
})
// Large results automatically compacted
```

### 5. Retrieve Compacted Results
```javascript
get_result("supabase_execute_sql_abc123")
// → Full result data
```

## Available Meta-Tools

| Tool | Description |
|------|-------------|
| `list_servers` | Discover available MCP backends |
| `list_mcp_tools` | List tool names (lightweight) |
| `get_tool_schema` | Get full schema for specific tool |
| `call_mcp_tool` | Execute any tool with auto-compaction |
| `get_result` | Retrieve compacted result by ID |
| `list_results` | Show all stored results |
| `check_server_health` | Monitor server connectivity |
| `get_bridge_stats` | Memory, cache, uptime stats |

## Configuration

Create `mcpbridge.config.json`:

```json
{
  "servers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "description": "My MCP Server",
      "enabled": true,
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

### Server Options

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Transport type (only `stdio` supported) |
| `command` | string | Command to run |
| `args` | array | Command arguments |
| `description` | string | Human-readable description |
| `enabled` | boolean | Enable/disable server |
| `env` | object | Environment variables |

## Context Savings

| Scenario | Without Bridge | With Bridge | Savings |
|----------|----------------|-------------|---------|
| List 29 Supabase tools | ~8,000 bytes | ~400 bytes | 95% |
| Get 1 tool schema | (included above) | ~300 bytes | N/A |
| **Use 1 tool** | ~8,000 bytes | ~700 bytes | **91%** |
| 12 servers × 20 tools | ~120,000 bytes | ~2,000 bytes | **98%** |

## Compaction Settings

Results are automatically compacted when:
- Size > 2KB
- Array has > 20 items

Compacted results include:
- Summary (type, size, item count)
- Preview (first 5 items)
- Reference ID (fetch full data with `get_result`)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude / AI Agent                        │
└─────────────────────────┬───────────────────────────────────┘
                          │ 8 meta-tools (~2KB context)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Bridge v2.1                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Tool Cache  │  │Result Store │  │ Connection Manager  │  │
│  │  (5 min)    │  │ (10 min)    │  │   (retry + pool)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ On-demand connections
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Supabase │    │  Clerk   │    │  Twilio  │  ... 
    │ 29 tools │    │ 19 tools │    │ 47 tools │
    └──────────┘    └──────────┘    └──────────┘
```

## Troubleshooting

**Server not showing up?**
- Restart Claude Desktop/Code after config changes
- Check paths are absolute, not relative
- Verify with `claude mcp list` (Claude Code)

**Connection errors?**
- Run `node /path/to/bridge-server.js` manually to check for errors
- Ensure `npm install` completed successfully
- Check `mcpbridge.config.json` exists and is valid JSON

**Tools not loading?**
- Use `check_server_health()` to diagnose
- Verify underlying MCP servers are configured correctly

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file

---

**Built by [@mahawi1992](https://github.com/mahawi1992)** 

*Reduce context, increase capability.* 🚀
