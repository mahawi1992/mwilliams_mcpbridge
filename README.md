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

## Quick Start (Step-by-Step Guide)

This is the exact workflow we used to build and validate the bridge. **Important: Always verify each MCP server works before adding it to the bridge.**

### Step 1: Install and Test Individual MCP Servers First

Before using the bridge, make sure each MCP server works on its own:

```bash
# Add Supabase MCP (requires access token)
claude mcp add supabase -s user -- npx -y @supabase/mcp-server-supabase@latest --access-token YOUR_TOKEN

# Add Context7 MCP (no auth required)
claude mcp add context7 -s user -- npx -y @upstash/context7-mcp@latest

# Add Browser MCP (no auth required)
claude mcp add browsermcp -s user -- npx @browsermcp/mcp@latest

# Verify all are connected
claude mcp list
```

Expected output:
```
supabase: npx -y @supabase/mcp-server-supabase@latest ... - ✓ Connected
context7: npx -y @upstash/context7-mcp@latest - ✓ Connected
browsermcp: npx @browsermcp/mcp@latest - ✓ Connected
```

### Step 2: Test Each Server Works

Start a Claude Code session and test each server:

```javascript
// Test Supabase
mcp__supabase__list_projects()

// Test Context7
mcp__context7__resolve-library-id({ libraryName: "react" })

// Test Browser MCP
mcp__browsermcp__browser_navigate({ url: "https://example.com" })
```

**Only proceed to Step 3 if all servers respond correctly!**

### Step 3: Install MCP Bridge

Now add the bridge server:

```bash
# Option A: Via npx (when published to npm)
claude mcp add mcp-bridge -s user -- npx -y mwilliams-mcpbridge

# Option B: Via local clone
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
claude mcp add mcp-bridge -s user -- node /full/path/to/bridge-server.js

# Verify bridge is connected
claude mcp list
```

### Step 4: Test the Bridge

Start a **new** Claude Code session (to load the bridge tools) and test:

```javascript
// List available servers through the bridge
list_servers()

// List tools from a server
list_mcp_tools({ server: "supabase" })

// Call a tool through the bridge
call_mcp_tool({
  server: "supabase",
  tool: "list_projects",
  arguments: {}
})

// Test Context7 through bridge
call_mcp_tool({
  server: "context7",
  tool: "resolve-library-id",
  arguments: { libraryName: "react" }
})

// Test Browser through bridge
call_mcp_tool({
  server: "browsermcp",
  tool: "browser_navigate",
  arguments: { url: "https://example.com" }
})
```

**Verify all three work through the bridge before proceeding!**

### Step 5: Remove Individual MCP Servers (Get the Token Savings!)

Once the bridge is working, remove the individual servers to get the 95% token savings:

```bash
# Remove individual servers
claude mcp remove supabase -s user
claude mcp remove context7 -s user
claude mcp remove browsermcp -s user

# Verify only bridge remains
claude mcp list
```

Expected output:
```
mcp-bridge: node /path/to/bridge-server.js - ✓ Connected
```

### Step 6: Enjoy 95% Token Savings!

Now all MCP calls go through the bridge:

```javascript
// Before: 45 tools taking ~31k tokens
// After: 3 tools taking ~1.5k tokens

// All your MCP calls now use this pattern:
call_mcp_tool({
  server: "supabase",
  tool: "execute_sql",
  arguments: {
    project_id: "your-project-id",
    query: "SELECT * FROM users LIMIT 10"
  }
})
```

## Our Journey: How We Built This

We ran into the MCP token problem ourselves. Here's what happened:

1. **Discovered the problem**: Running `/context` in Claude Code showed MCP tools consuming 31.7k tokens (15.9% of context)

2. **Found Anthropic's solution**: Their ["Code Execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp) post described reducing 150k tokens to 2k tokens

3. **Built the bridge**: Created an MCP server that acts as a proxy to other MCP servers

4. **Key insight**: You MUST verify each MCP server works individually before adding to the bridge. The bridge just forwards calls - if the underlying server is broken, the bridge can't fix it.

5. **The result**: 45 tools → 3 tools, ~31k tokens → ~1.5k tokens

## Installation Options

### Option A: Clone and Run (Recommended for Testing)

```bash
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
claude mcp add mcp-bridge -s user -- node $(pwd)/bridge-server.js
```

### Option B: npx (When Published)

```bash
claude mcp add mcp-bridge -s user -- npx -y mwilliams-mcpbridge
```

### Option C: Manual Config

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "mcp-bridge": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/bridge-server.js"]
    }
  }
}
```

## Configuration

### Adding Your Own MCP Servers

Create `mcpbridge.config.json` in your project root:

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
    "browsermcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["@browsermcp/mcp@latest"],
      "description": "Browser automation",
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

Or set config path via environment variable:

```bash
MCPBRIDGE_CONFIG=/path/to/config.json claude mcp add mcp-bridge ...
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MCPBRIDGE_CONFIG` | Path to custom config file |
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API token (required for Supabase) |

## Usage Examples

### List Servers
```javascript
list_servers()
// Returns available backends
```

### Discover Tools
```javascript
list_mcp_tools({ server: "supabase" })
// Returns all 29 Supabase tools with descriptions
```

### Execute SQL
```javascript
call_mcp_tool({
  server: "supabase",
  tool: "execute_sql",
  arguments: {
    project_id: "your-project-id",
    query: "SELECT COUNT(*) FROM users"
  }
})
```

### Get Library Docs
```javascript
call_mcp_tool({
  server: "context7",
  tool: "get-library-docs",
  arguments: {
    context7CompatibleLibraryID: "/vercel/next.js",
    topic: "routing"
  }
})
```

### Browser Automation
```javascript
call_mcp_tool({
  server: "browsermcp",
  tool: "browser_navigate",
  arguments: { url: "https://example.com" }
})

call_mcp_tool({
  server: "browsermcp",
  tool: "browser_snapshot",
  arguments: {}
})
```

## Default Servers

| Server | Package | Auth Required | Description |
|--------|---------|---------------|-------------|
| `supabase` | `@supabase/mcp-server-supabase` | Yes (access token) | Database, migrations, edge functions |
| `context7` | `@upstash/context7-mcp` | No | Up-to-date library documentation |
| `browsermcp` | `@browsermcp/mcp` | No | Browser automation |

## Performance

| Metric | Native MCP | MCP Bridge |
|--------|------------|------------|
| Tools in context | 45 | 3 |
| Context tokens | ~31,000 | ~1,500 |
| Latency | Direct | +1 hop (~10-50ms) |
| Token savings | - | **~95%** |

## Troubleshooting

### "Unknown server" error

The server isn't configured or enabled:
```javascript
// Check available servers
list_servers()
```

### Server won't connect

Test the underlying MCP server directly:
```bash
# Test Supabase
npx -y @supabase/mcp-server-supabase@latest --help

# Test Context7
npx -y @upstash/context7-mcp@latest --help
```

### Tool not found

List tools first to get exact names:
```javascript
list_mcp_tools({ server: "supabase" })
// Use exact tool name from the response
```

### Bridge not loading

1. Restart Claude Code after adding the bridge
2. Check `claude mcp list` shows bridge as connected
3. Verify the bridge-server.js path is correct

## How It Works Internally

1. **MCP Bridge** starts as a standard MCP server using stdio transport
2. When Claude calls `call_mcp_tool(server, tool, args)`:
   - Bridge checks if it has a cached connection to `server`
   - If not, spawns the server process and connects via MCP SDK
   - Forwards the tool call with arguments
   - Returns the result to Claude
3. Connections are cached for subsequent calls
4. Claude only sees 3 tools instead of 45+

## Comparison with Anthropic's Approach

This implements the pattern from [Anthropic's "Code Execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp):

> "By exposing tools as files and letting the agent discover them on-demand, we reduced context from 150k tokens to 2k tokens."

MCP Bridge achieves similar savings while staying within the MCP ecosystem - no need to change how you call tools, just route them through the bridge.

## Contributing

```bash
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE)

## Credits

- Inspired by [Anthropic's Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Built with [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Related

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Supabase MCP Server](https://github.com/supabase/mcp-server-supabase)
- [Context7 MCP](https://github.com/upstash/context7-mcp)
- [Browser MCP](https://github.com/anthropics/anthropic-tools)
