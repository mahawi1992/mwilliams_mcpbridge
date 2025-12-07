# MCP Bridge v2.1 - AI System Prompt

Copy this into your CLAUDE.md or system prompt to help AI assistants use MCP Bridge effectively.

---

## MCP Bridge Usage

You have access to MCP Bridge, a universal proxy that provides **8 meta-tools** to call ANY configured MCP server. This reduces context usage by **99%** through lazy schema loading and result compaction.

### Available Tools

| Tool | Purpose |
|------|---------|
| `list_servers` | Discover all configured MCP backends |
| `list_mcp_tools` | List tool NAMES from a server (lightweight) |
| `get_tool_schema` | Get full schema for a SPECIFIC tool (lazy loading) |
| `call_mcp_tool` | Execute any tool with auto-compaction |
| `get_result` | Retrieve full data from compacted results |
| `list_results` | Show all stored compacted results |
| `check_server_health` | Monitor server connectivity |
| `get_bridge_stats` | View cache, memory, and uptime stats |

---

## Usage Patterns

### Pattern 1: Minimal Context (Recommended)

**Step 1: List tool names only (saves 90% context)**
```javascript
list_mcp_tools({ server: "supabase" })
// Returns: { tools: ["execute_sql", "list_tables", ...], tool_count: 29 }
// Only ~400 bytes instead of ~8KB!
```

**Step 2: Get schema for ONLY the tool you need**
```javascript
get_tool_schema({ server: "supabase", tool: "execute_sql" })
// Returns: { tool: "execute_sql", inputSchema: { ... } }
```

**Step 3: Call the tool**
```javascript
call_mcp_tool({
  server: "supabase",
  tool: "execute_sql",
  arguments: { project_id: "xxx", query: "SELECT * FROM users" }
})
```

### Pattern 2: Handling Large Results

When results exceed 2KB, they're automatically compacted:

```javascript
// Call returns a preview + reference
call_mcp_tool({ server: "supabase", tool: "execute_sql", arguments: {...} })
// Returns: {
//   compacted: true,
//   result_id: "supabase_execute_sql_abc123",
//   summary: { type: "object", row_count: 500, size: "48.2KB" },
//   preview: { rows: [...first 5 items...] }
// }

// If you need full data:
get_result({ result_id: "supabase_execute_sql_abc123" })
// Returns: All 500 rows
```

### Pattern 3: Verbose Tool Listing (When Needed)

```javascript
list_mcp_tools({ server: "supabase", verbose: true })
// Returns: { tools: [{ name: "execute_sql", description: "..." }, ...] }
```

---

## Example Workflows

### Database Query (Supabase)
```javascript
// User: "Get all users from my database"

// 1. Check what tools are available
list_mcp_tools({ server: "supabase" })

// 2. Get schema for execute_sql
get_tool_schema({ server: "supabase", tool: "execute_sql" })

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

### Documentation Lookup (Context7)
```javascript
// User: "How do I use React hooks?"

// 1. Get docs
call_mcp_tool({
  server: "context7",
  tool: "get-library-docs",
  arguments: {
    context7CompatibleLibraryID: "/facebook/react",
    topic: "hooks"
  }
})
```

### Health Check
```javascript
// Check all servers
check_server_health()
// Returns: { summary: { healthy: 11, unhealthy: 1 }, servers: [...] }

// Check specific server
check_server_health({ server: "supabase" })
```

### View Bridge Statistics
```javascript
get_bridge_stats()
// Returns: {
//   version: "2.1.0",
//   servers: { configured: 12, connected: 5 },
//   caches: { tools_cached: 3, results_stored: 2 },
//   memory: { heap_used_mb: 12.5 }
// }
```

---

## Key Rules

1. **Use lazy loading** - Call `list_mcp_tools` for names, then `get_tool_schema` for specific tool
2. **Don't load all schemas** - Only fetch what you need to save context
3. **Handle compacted results** - Use `get_result(id)` when you need full data
4. **Check health first** - Use `check_server_health` if a server seems unresponsive
5. **Results expire** - Compacted results last 10 minutes, then auto-delete

---

## Error Handling

```javascript
// Error: "Unknown server: xyz"
// → Use list_servers() to see available servers

// Error: "Tool not found: abc"
// → Use list_mcp_tools({ server: "xyz" }) to see available tools

// Error: "Result not found"
// → Result expired (10 min TTL). Re-run the original call.

// Error: "Connection timeout"
// → Server may be starting up. Use check_server_health() then retry.
```

---

## Context Savings

| Action | Without Bridge | With Bridge v2.1 | Savings |
|--------|----------------|------------------|---------|
| List 29 tools | ~8,000 bytes | ~400 bytes | **95%** |
| Get 1 schema | (included) | ~300 bytes | N/A |
| Use 1 tool | ~8,000 bytes | ~700 bytes | **91%** |
| 12 servers | ~120KB | ~2KB | **98%** |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                MCP BRIDGE v2.1 CHEAT SHEET                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DISCOVER                                                   │
│    list_servers()                                           │
│    list_mcp_tools({ server: "name" })                       │
│    get_tool_schema({ server: "name", tool: "tool" })        │
│                                                             │
│  EXECUTE                                                    │
│    call_mcp_tool({ server, tool, arguments })               │
│                                                             │
│  RESULTS                                                    │
│    get_result({ result_id: "xxx" })                         │
│    list_results()                                           │
│                                                             │
│  MONITOR                                                    │
│    check_server_health()                                    │
│    get_bridge_stats()                                       │
│                                                             │
│  FLOW: list_mcp_tools → get_tool_schema → call_mcp_tool    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
