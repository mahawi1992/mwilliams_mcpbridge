# MCP Bridge - AI System Prompt

Copy this into your CLAUDE.md or system prompt to help AI assistants use MCP Bridge effectively.

---

## MCP Bridge Usage

You have access to MCP Bridge, a universal proxy that provides 3 meta-tools to call ANY configured MCP server. This dramatically reduces context usage while maintaining full MCP functionality.

### Available Tools

| Tool | Purpose |
|------|---------|
| `list_servers` | Discover all configured MCP backends |
| `list_mcp_tools` | List available tools from a specific server |
| `call_mcp_tool` | Execute any tool from any server |

### Usage Pattern (IMPORTANT - Always Follow This Order)

**Step 1: Discover available servers**
```javascript
list_servers()
// Returns: { servers: [{ name: "supabase", description: "..." }, ...] }
```

**Step 2: List tools from the server you need**
```javascript
list_mcp_tools({ server: "server_name" })
// Returns: { tools: [{ name: "tool_name", description: "..." }, ...] }
```

**Step 3: Call the specific tool**
```javascript
call_mcp_tool({
  server: "server_name",
  tool: "tool_name",
  arguments: { /* tool-specific arguments */ }
})
```

### Example Workflows

#### Database Query (Supabase)
```javascript
// User: "Get all users from my database"

// 1. Verify supabase is available
list_servers()

// 2. Find the SQL tool
list_mcp_tools({ server: "supabase" })

// 3. Execute query
call_mcp_tool({
  server: "supabase",
  tool: "execute_sql",
  arguments: {
    project_id: "your-project-id",
    query: "SELECT * FROM users LIMIT 10"
  }
})
```

#### Documentation Lookup (Context7)
```javascript
// User: "How do I use React hooks?"

// 1. Find the library ID
call_mcp_tool({
  server: "context7",
  tool: "resolve-library-id",
  arguments: { libraryName: "react" }
})

// 2. Get documentation
call_mcp_tool({
  server: "context7",
  tool: "get-library-docs",
  arguments: {
    context7CompatibleLibraryID: "/facebook/react",
    topic: "hooks"
  }
})
```

#### Browser Automation (BrowserMCP)
```javascript
// User: "Take a screenshot of example.com"

// 1. Navigate to page
call_mcp_tool({
  server: "browsermcp",
  tool: "browser_navigate",
  arguments: { url: "https://example.com" }
})

// 2. Take screenshot
call_mcp_tool({
  server: "browsermcp",
  tool: "browser_screenshot",
  arguments: {}
})
```

### Key Rules

1. **Always discover before calling** - Use `list_mcp_tools` before calling an unfamiliar tool
2. **Exact names required** - Tool names are case-sensitive and must match exactly
3. **Check arguments** - Each tool has different required arguments; check the tool listing
4. **Handle errors gracefully** - If a tool fails, verify the name and arguments with `list_mcp_tools`
5. **Server must be configured** - Only servers in the config file are available

### Error Handling

If you get an error:
```javascript
// Error: "Unknown server: xyz"
// → Use list_servers() to see available servers

// Error: "Tool not found: abc"
// → Use list_mcp_tools({ server: "xyz" }) to see available tools

// Error: "Invalid arguments"
// → Check the tool's schema in list_mcp_tools output
```

### Common Servers Reference

| Server | Common Tools | Use Case |
|--------|-------------|----------|
| `supabase` | `execute_sql`, `list_tables`, `apply_migration` | Database operations |
| `context7` | `resolve-library-id`, `get-library-docs` | Documentation lookup |
| `browsermcp` | `browser_navigate`, `browser_click`, `browser_snapshot` | Browser automation |
| `github` | `create_issue`, `list_repos`, `create_pr` | GitHub operations |
| `filesystem` | `read_file`, `write_file`, `list_directory` | File system access |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP BRIDGE CHEAT SHEET                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. LIST SERVERS                                            │
│     list_servers()                                          │
│                                                             │
│  2. LIST TOOLS                                              │
│     list_mcp_tools({ server: "name" })                      │
│                                                             │
│  3. CALL TOOL                                               │
│     call_mcp_tool({                                         │
│       server: "name",                                       │
│       tool: "tool_name",                                    │
│       arguments: { ... }                                    │
│     })                                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
