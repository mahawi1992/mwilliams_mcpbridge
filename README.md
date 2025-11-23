# MCP Bridge

**Single Tool to Rule Them All** - An MCP server that proxies calls to any other MCP server, reducing context token usage by ~95%.

[![npm version](https://img.shields.io/npm/v/mwilliams-mcpbridge.svg)](https://www.npmjs.com/package/mwilliams-mcpbridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

When using Claude with multiple MCP servers, each server's tools consume context tokens:

| MCP Server | Tools | Tokens |
|------------|-------|--------|
| Supabase | 29 | ~18,000 |
| Browser MCP | 12 | ~7,000 |
| Context7 | 2 | ~1,700 |
| CopilotKit | 2 | ~1,600 |
| **Total** | **45** | **~31,000** |

That's 15% of your context window gone before you even start!

## The Solution

MCP Bridge exposes just **3 meta-tools** that can call any tool from any server:

| Tool | Purpose |
|------|---------|
| `list_servers` | Discover available MCP backends |
| `list_mcp_tools` | List tools from a specific server |
| `call_mcp_tool` | Call ANY tool from ANY server |

**Result: ~31,000 tokens → ~1,500 tokens (95% reduction)**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude / LLM                          │
│                                                             │
│  Before: 45 tools loaded          After: 3 tools loaded    │
│  ├── supabase (29 tools)          ├── list_servers         │
│  ├── browsermcp (12 tools)   →    ├── list_mcp_tools       │
│  ├── context7 (2 tools)           └── call_mcp_tool        │
│  └── copilotkit (2 tools)                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Bridge                             │
│                                                             │
│   call_mcp_tool("supabase", "execute_sql", {...})          │
│                              │                              │
│                              ▼                              │
│   ┌─────────┐  ┌──────────┐  ┌───────────┐                 │
│   │Supabase │  │ Context7 │  │ BrowserMCP│  ... more       │
│   └─────────┘  └──────────┘  └───────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### With Claude Code (Recommended)

```bash
# Install globally
claude mcp add mcpbridge -s user -- npx -y mwilliams-mcpbridge

# Or with a local clone
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
claude mcp add mcpbridge -s user -- node /path/to/bridge-server.js
```

### With npm

```bash
npm install -g mwilliams-mcpbridge
mcpbridge  # Starts the server
```

### Manual Configuration

Add to your Claude config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "mcpbridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mwilliams-mcpbridge"]
    }
  }
}
```

## Usage

### 1. List Available Servers

```javascript
list_servers()
// Returns:
{
  "servers": [
    { "name": "supabase", "description": "Supabase database operations" },
    { "name": "context7", "description": "Up-to-date library documentation" },
    { "name": "browsermcp", "description": "Browser automation" }
  ]
}
```

### 2. Discover Tools

```javascript
list_mcp_tools({ server: "supabase" })
// Returns:
{
  "server": "supabase",
  "tool_count": 29,
  "tools": [
    { "name": "execute_sql", "description": "Execute raw SQL query" },
    { "name": "list_tables", "description": "List tables in schemas" },
    // ... 27 more tools
  ]
}
```

### 3. Call Any Tool

```javascript
// Execute SQL on Supabase
call_mcp_tool({
  server: "supabase",
  tool: "execute_sql",
  arguments: {
    project_id: "your-project-id",
    query: "SELECT COUNT(*) FROM users"
  }
})

// Get documentation from Context7
call_mcp_tool({
  server: "context7",
  tool: "get-library-docs",
  arguments: {
    context7CompatibleLibraryID: "/vercel/next.js",
    topic: "routing"
  }
})

// Automate browser
call_mcp_tool({
  server: "browsermcp",
  tool: "browser_navigate",
  arguments: {
    url: "https://example.com"
  }
})
```

## Configuration

### Custom Server Configuration

Create `mcpbridge.config.json` in your project root or set `MCPBRIDGE_CONFIG` environment variable:

```json
{
  "servers": {
    "supabase": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "YOUR_TOKEN"],
      "description": "Supabase database operations",
      "enabled": true
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"],
      "description": "Library documentation",
      "enabled": true
    },
    "my-custom-server": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/my-server.js"],
      "description": "My custom MCP server",
      "enabled": true
    }
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MCPBRIDGE_CONFIG` | Path to custom config file |
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API token |

## Default Servers

Out of the box, MCP Bridge supports:

| Server | Package | Description |
|--------|---------|-------------|
| `supabase` | `@supabase/mcp-server-supabase` | Database, migrations, edge functions |
| `context7` | `@upstash/context7-mcp` | Up-to-date library documentation |
| `browsermcp` | `@browsermcp/mcp` | Browser automation |

## How It Works

1. MCP Bridge starts as a standard MCP server (stdio transport)
2. When Claude calls `call_mcp_tool`, the bridge:
   - Lazily connects to the target MCP server (connections are cached)
   - Forwards the tool call with arguments
   - Returns the result to Claude
3. Claude only sees 3 tools instead of 45+

## Performance

| Metric | Native MCP | MCP Bridge |
|--------|------------|------------|
| Tools in context | 45 | 3 |
| Context tokens | ~31,000 | ~1,500 |
| Latency | Direct | +1 hop |
| Token savings | - | **~95%** |

The extra hop adds minimal latency (~10-50ms) but saves significant context for longer conversations.

## Comparison with Anthropic's Approach

This implements the pattern described in [Anthropic's "Code Execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp) blog post:

> "By exposing tools as files and letting the agent discover them on-demand, we reduced context from 150k tokens to 2k tokens."

MCP Bridge takes a similar approach but stays within the MCP ecosystem, making it compatible with any MCP-enabled client.

## Troubleshooting

### Server won't connect

```bash
# Check if the underlying server works
npx -y @supabase/mcp-server-supabase@latest --help
```

### Tool not found

```javascript
// First, list available tools
list_mcp_tools({ server: "supabase" })

// Then use the exact tool name from the list
call_mcp_tool({ server: "supabase", tool: "execute_sql", arguments: {...} })
```

### Custom server not showing

Make sure your config has `"enabled": true` and the command/args are correct.

## Contributing

Contributions welcome! Please read our contributing guidelines first.

```bash
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
npm test
```

## License

MIT - see [LICENSE](LICENSE)

## Credits

- Inspired by [Anthropic's Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Built with [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Related

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Claude Code](https://claude.ai/claude-code)
- [Supabase MCP Server](https://github.com/supabase/mcp-server-supabase)
