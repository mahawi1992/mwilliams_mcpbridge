#!/usr/bin/env node
/**
 * MCP Bridge Server - Single Tool to Rule Them All
 *
 * Implements Anthropic's "Code Execution with MCP" pattern by providing
 * a single `call_mcp_tool` that can invoke ANY tool from ANY connected MCP server.
 *
 * This reduces context from ~31k tokens (45 tools) to ~1.5k tokens (3 tools).
 * That's a ~95% reduction in context usage!
 *
 * Usage:
 *   npx mwilliams-mcpbridge                    # Run with default servers
 *   MCPBRIDGE_CONFIG=/path/to/config.json npx mwilliams-mcpbridge  # Custom config
 *
 * @author mwilliams
 * @license MIT
 * @see https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration from file or use defaults
function loadConfig() {
  // Check for custom config path
  const customConfigPath = process.env.MCPBRIDGE_CONFIG;
  if (customConfigPath && existsSync(customConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(customConfigPath, 'utf-8'));
      console.error(`[mcpbridge] Loaded config from ${customConfigPath}`);
      return config.servers || {};
    } catch (e) {
      console.error(`[mcpbridge] Error loading config: ${e.message}`);
    }
  }

  // Check for config in current directory
  const localConfig = join(process.cwd(), 'mcpbridge.config.json');
  if (existsSync(localConfig)) {
    try {
      const config = JSON.parse(readFileSync(localConfig, 'utf-8'));
      console.error(`[mcpbridge] Loaded config from ${localConfig}`);
      return config.servers || {};
    } catch (e) {
      console.error(`[mcpbridge] Error loading local config: ${e.message}`);
    }
  }

  // Default servers - common MCP servers
  return {
    supabase: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase@latest', '--access-token',
             process.env.SUPABASE_ACCESS_TOKEN || ''],
      description: 'Supabase database operations',
      enabled: !!process.env.SUPABASE_ACCESS_TOKEN
    },
    context7: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@latest'],
      description: 'Up-to-date library documentation',
      enabled: true
    },
    browsermcp: {
      type: 'stdio',
      command: 'npx',
      args: ['@browsermcp/mcp@latest'],
      description: 'Browser automation',
      enabled: true
    }
  };
}

const SERVERS = loadConfig();

// Filter to only enabled servers
const enabledServers = Object.entries(SERVERS)
  .filter(([_, config]) => config.enabled !== false)
  .map(([name]) => name);

// Client cache for connection reuse
const clientCache = new Map();

/**
 * Get or create an MCP client connection to a server
 * Connections are cached for performance
 */
async function getClient(serverName) {
  if (clientCache.has(serverName)) {
    return clientCache.get(serverName);
  }

  const config = SERVERS[serverName];
  if (!config) {
    throw new Error(`Unknown server: ${serverName}. Available: ${enabledServers.join(', ')}`);
  }

  if (config.enabled === false) {
    throw new Error(`Server ${serverName} is disabled. Check your configuration.`);
  }

  if (config.type !== 'stdio') {
    throw new Error(`Server ${serverName} uses ${config.type} transport. Only stdio is currently supported.`);
  }

  const client = new Client({
    name: 'mcpbridge-client',
    version: '1.0.0'
  });

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env }
  });

  await client.connect(transport);
  clientCache.set(serverName, client);

  console.error(`[mcpbridge] Connected to ${serverName}`);
  return client;
}

// Initialize the MCP Bridge Server
const server = new McpServer({
  name: 'mcpbridge',
  version: '1.0.0'
});

// Tool: List available servers
server.registerTool(
  'list_servers',
  {
    title: 'List Available MCP Servers',
    description: 'List all MCP servers that can be called via call_mcp_tool. Use this first to discover available backends.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  async () => {
    const servers = Object.entries(SERVERS)
      .filter(([_, config]) => config.enabled !== false)
      .map(([name, config]) => ({
        name,
        description: config.description || 'No description'
      }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          servers,
          count: servers.length,
          usage: "Use list_mcp_tools(server) to see tools, then call_mcp_tool(server, tool, arguments) to call them"
        }, null, 2)
      }]
    };
  }
);

// Tool: List tools from a server
server.registerTool(
  'list_mcp_tools',
  {
    title: 'List MCP Server Tools',
    description: 'List all available tools from a specific MCP server. Use this to discover what tools are available before calling them.',
    inputSchema: {
      server: z.enum(enabledServers.length > 0 ? enabledServers : ['none'])
        .describe('MCP server to list tools from')
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  async ({ server: serverName }) => {
    try {
      const client = await getClient(serverName);
      const result = await client.listTools();

      const tools = result.tools.map(t => ({
        name: t.name,
        description: (t.description || '').slice(0, 200)
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: serverName,
            tool_count: tools.length,
            tools
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
        isError: true
      };
    }
  }
);

// Tool: Call any MCP tool - THE MAIN EVENT
server.registerTool(
  'call_mcp_tool',
  {
    title: 'Call MCP Tool',
    description: `Call any tool from any connected MCP server. This single tool replaces dozens of individual MCP tools.

Available Servers: ${enabledServers.join(', ')}

Usage Pattern:
1. list_servers() - See available backends
2. list_mcp_tools(server) - Discover tools
3. call_mcp_tool(server, tool, arguments) - Execute

Examples:
- call_mcp_tool("supabase", "execute_sql", {"project_id": "xyz", "query": "SELECT 1"})
- call_mcp_tool("context7", "get-library-docs", {"context7CompatibleLibraryID": "/vercel/next.js"})
- call_mcp_tool("browsermcp", "browser_navigate", {"url": "https://example.com"})`,
    inputSchema: {
      server: z.enum(enabledServers.length > 0 ? enabledServers : ['none'])
        .describe('MCP server to call'),
      tool: z.string().min(1).max(100)
        .describe('Tool name to call (use list_mcp_tools to discover available tools)'),
      arguments: z.record(z.any()).optional().default({})
        .describe('JSON object of arguments to pass to the tool')
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async ({ server: serverName, tool, arguments: args }) => {
    try {
      const client = await getClient(serverName);

      const result = await client.callTool({
        name: tool,
        arguments: args || {}
      });

      // Extract and return content
      if (result.content && result.content.length > 0) {
        const texts = result.content
          .filter(item => item.type === 'text')
          .map(item => item.text);
        return {
          content: [{ type: 'text', text: texts.join('\n') }]
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            server: serverName,
            tool,
            hint: `Use list_mcp_tools("${serverName}") to see available tools and their parameters`
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('[mcpbridge] Shutting down...');
  for (const [name, client] of clientCache) {
    try {
      await client.close();
    } catch (e) {
      // Ignore close errors
    }
  }
  process.exit(0);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcpbridge] MCP Bridge Server started');
console.error(`[mcpbridge] Enabled servers: ${enabledServers.join(', ')}`);
