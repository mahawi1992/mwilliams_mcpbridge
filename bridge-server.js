#!/usr/bin/env node
/**
 * MCP Bridge Server v2.3.0 - Simplified Edition
 *
 * Consolidates multiple MCP servers behind a single interface with lazy schema loading.
 *
 * Features:
 * - Lazy schema loading: list_mcp_tools returns names only, get_tool_schema for details
 * - Tool caching: 5-minute TTL for tool schemas
 * - Retry logic: Exponential backoff with jitter
 * - Health checks: Monitor server connectivity
 *
 * @author mwilliams
 * @version 2.3.0
 * @license MIT
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Retry settings
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
  },
  // Connection settings
  connectionTimeoutMs: 30000,
  // Cache settings
  toolsCacheTtlMs: 300000 // 5 minutes
};

// ============================================================================
// LOAD SERVER CONFIGURATION
// ============================================================================

function loadConfig() {
  const configPath = join(__dirname, 'mcpbridge.config.json');
  
  if (!existsSync(configPath)) {
    console.error(`[mcpbridge] Config not found: ${configPath}`);
    console.error('[mcpbridge] Copy mcpbridge.config.example.json to mcpbridge.config.json');
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return config.servers || {};
  } catch (error) {
    console.error(`[mcpbridge] Failed to parse config: ${error.message}`);
    process.exit(1);
  }
}

const SERVERS = loadConfig();
const enabledServers = Object.entries(SERVERS)
  .filter(([_, config]) => config.enabled !== false)
  .map(([name]) => name);

console.error(`[mcpbridge] Loaded ${enabledServers.length} servers: ${enabledServers.join(', ')}`);

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

const connections = new Map(); // serverName -> { client, transport, connected }
const toolsCache = new Map(); // serverName -> { tools, cachedAt }

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function getRetryDelay(attempt) {
  const baseDelay = CONFIG.retry.baseDelayMs * Math.pow(CONFIG.retry.backoffMultiplier, attempt);
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay + jitter, CONFIG.retry.maxDelayMs);
}

/**
 * Get or create connection to an MCP server
 */
async function getConnection(serverName) {
  // Check existing connection
  const existing = connections.get(serverName);
  if (existing?.connected) {
    return existing.client;
  }
  
  const serverConfig = SERVERS[serverName];
  if (!serverConfig) {
    throw new Error(`Unknown server: ${serverName}. Available: ${enabledServers.join(', ')}`);
  }
  
  if (serverConfig.enabled === false) {
    throw new Error(`Server ${serverName} is disabled`);
  }
  
  // Build environment
  const env = { ...process.env, ...serverConfig.env };
  
  // Create transport and client
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env,
    cwd: serverConfig.cwd
  });
  
  const client = new Client(
    { name: `mcpbridge->${serverName}`, version: '2.3.0' },
    { capabilities: {} }
  );
  
  // Connect with timeout
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Connection timeout')), CONFIG.connectionTimeoutMs)
  );
  
  try {
    await Promise.race([connectPromise, timeoutPromise]);
    connections.set(serverName, { client, transport, connected: true });
    console.error(`[mcpbridge] Connected to ${serverName}`);
    return client;
  } catch (error) {
    connections.set(serverName, { client, transport, connected: false });
    throw new Error(`Failed to connect to ${serverName}: ${error.message}`);
  }
}

/**
 * Get tools from a server (with caching)
 */
async function getServerTools(serverName) {
  // Check cache
  const cached = toolsCache.get(serverName);
  if (cached && (Date.now() - cached.cachedAt) < CONFIG.toolsCacheTtlMs) {
    return cached.tools;
  }
  
  // Fetch fresh
  const client = await getConnection(serverName);
  const result = await client.listTools();
  const tools = result.tools || [];
  
  // Cache it
  toolsCache.set(serverName, { tools, cachedAt: Date.now() });
  console.error(`[mcpbridge] Cached ${tools.length} tools from ${serverName}`);
  
  return tools;
}

/**
 * Execute a tool call with retry logic
 */
async function executeToolCall(serverName, toolName, args) {
  let lastError;
  
  for (let attempt = 0; attempt <= CONFIG.retry.maxRetries; attempt++) {
    try {
      const client = await getConnection(serverName);
      const result = await client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[mcpbridge] ${serverName}.${toolName} attempt ${attempt + 1} failed: ${error.message}`);
      
      // Clear connection on error
      const conn = connections.get(serverName);
      if (conn) {
        conn.connected = false;
      }
      
      if (attempt < CONFIG.retry.maxRetries) {
        const delay = getRetryDelay(attempt);
        console.error(`[mcpbridge] Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  throw new Error(`${serverName}.${toolName} failed after ${CONFIG.retry.maxRetries + 1} attempts: ${lastError.message}`);
}

// ============================================================================
// BRIDGE TOOLS DEFINITION
// ============================================================================

const TOOLS = [
  {
    name: 'list_servers',
    description: 'List all MCP servers available via call_mcp_tool. Use this first to discover backends.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'list_mcp_tools',
    description: 'List tool NAMES only from an MCP server (lightweight). Use get_tool_schema() for full schema of a specific tool.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: `MCP server to list tools from. Available: ${enabledServers.join(', ')}`,
          enum: enabledServers.length > 0 ? enabledServers : ['none']
        },
        verbose: {
          type: 'boolean',
          description: 'Include descriptions (default: false for minimal context)'
        },
        refresh: {
          type: 'boolean',
          description: 'Bypass cache and fetch fresh tools list (default: false)'
        }
      },
      required: ['server']
    }
  },
  {
    name: 'get_tool_schema',
    description: 'Get the full schema for a SPECIFIC tool. Use this before calling unfamiliar tools to see required parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'MCP server name',
          enum: enabledServers.length > 0 ? enabledServers : ['none']
        },
        tool: {
          type: 'string',
          description: 'Tool name to get schema for'
        }
      },
      required: ['server', 'tool']
    }
  },
  {
    name: 'call_mcp_tool',
    description: `Call any tool from any MCP server. Returns full results. Available servers: ${enabledServers.join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'MCP server to call',
          enum: enabledServers.length > 0 ? enabledServers : ['none']
        },
        tool: {
          type: 'string',
          description: 'Tool name to call'
        },
        arguments: {
          type: 'object',
          description: 'Arguments to pass to the tool',
          additionalProperties: true
        }
      },
      required: ['server', 'tool']
    }
  },
  {
    name: 'check_server_health',
    description: 'Check health and connectivity of one or all MCP servers. Returns connection status, response time, and tool count.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Specific server to check (omit to check all servers)',
          enum: enabledServers.length > 0 ? enabledServers : ['none']
        }
      },
      required: []
    }
  },
  {
    name: 'get_bridge_stats',
    description: 'Get bridge statistics: connected servers, cached tools, memory usage.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

// ============================================================================
// SERVER SETUP
// ============================================================================

const server = new Server(
  { name: 'mcp-bridge', version: '2.3.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    // ========== list_servers ==========
    if (name === 'list_servers') {
      const servers = Object.entries(SERVERS)
        .filter(([_, config]) => config.enabled !== false)
        .map(([name, config]) => ({
          name,
          description: config.description || 'No description',
          command: config.command
        }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ servers, count: servers.length }, null, 2)
        }]
      };
    }

    // ========== list_mcp_tools (lightweight - names only by default) ==========
    if (name === 'list_mcp_tools') {
      const serverName = args?.server;
      const verbose = args?.verbose === true;
      const refresh = args?.refresh === true;
      
      if (!serverName) {
        throw new Error('server parameter required. Available: ' + enabledServers.join(', '));
      }
      
      // Clear cache if refresh requested
      if (refresh) {
        toolsCache.delete(serverName);
      }
      
      const tools = await getServerTools(serverName);
      
      if (verbose) {
        // Return names + descriptions
        const toolList = tools.map(t => ({
          name: t.name,
          description: t.description || 'No description'
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              server: serverName,
              tools: toolList,
              count: toolList.length,
              hint: "Use get_tool_schema(server, tool) for full parameter details"
            }, null, 2)
          }]
        };
      }
      
      // Return names only (minimal context)
      const toolNames = tools.map(t => t.name);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: serverName,
            tools: toolNames,
            count: toolNames.length,
            hint: "Use get_tool_schema(server, tool) for full parameter details"
          }, null, 2)
        }]
      };
    }

    // ========== get_tool_schema ==========
    if (name === 'get_tool_schema') {
      const serverName = args?.server;
      const toolName = args?.tool;
      
      if (!serverName) {
        throw new Error('server parameter required');
      }
      if (!toolName) {
        throw new Error('tool parameter required');
      }
      
      const tools = await getServerTools(serverName);
      const tool = tools.find(t => t.name === toolName);
      
      if (!tool) {
        const available = tools.map(t => t.name).slice(0, 10);
        throw new Error(`Tool "${toolName}" not found in ${serverName}. Available: ${available.join(', ')}${tools.length > 10 ? '...' : ''}`);
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: serverName,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }, null, 2)
        }]
      };
    }

    // ========== call_mcp_tool ==========
    if (name === 'call_mcp_tool') {
      const serverName = args?.server;
      const toolName = args?.tool;
      const toolArgs = args?.arguments || {};

      if (!serverName) {
        throw new Error('server parameter required. Available: ' + enabledServers.join(', '));
      }
      if (!toolName) {
        throw new Error('tool parameter required. Use list_mcp_tools("' + serverName + '") to see available tools.');
      }

      const result = await executeToolCall(serverName, toolName, toolArgs);
      const elapsed = Date.now() - startTime;
      console.error(`[mcpbridge] ${serverName}.${toolName} completed in ${elapsed}ms`);

      // Return full results as-is
      if (result.content && result.content.length > 0) {
        return { content: result.content };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // ========== check_server_health ==========
    if (name === 'check_server_health') {
      const serverName = args?.server;
      const results = [];
      
      const serversToCheck = serverName ? [serverName] : enabledServers;
      
      for (const srv of serversToCheck) {
        const checkStart = Date.now();
        try {
          const tools = await getServerTools(srv);
          const elapsed = Date.now() - checkStart;
          results.push({
            server: srv,
            status: 'healthy',
            response_time_ms: elapsed,
            tool_count: tools.length
          });
        } catch (error) {
          results.push({
            server: srv,
            status: 'error',
            error: error.message
          });
        }
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ health: results }, null, 2)
        }]
      };
    }

    // ========== get_bridge_stats ==========
    if (name === 'get_bridge_stats') {
      const connectedServers = Array.from(connections.entries())
        .filter(([_, conn]) => conn.connected)
        .map(([name]) => name);
      
      const cachedToolsCount = Array.from(toolsCache.values())
        .reduce((sum, cache) => sum + cache.tools.length, 0);
      
      const memUsage = process.memoryUsage();
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            version: '2.3.0',
            configured_servers: enabledServers.length,
            connected_servers: connectedServers.length,
            connected: connectedServers,
            cached_tools: cachedToolsCount,
            cache_entries: toolsCache.size,
            memory: {
              heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10,
              heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10
            },
            uptime_seconds: Math.round(process.uptime())
          }, null, 2)
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    console.error(`[mcpbridge] Error in ${name}: ${error.message}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: error.message }, null, 2)
      }],
      isError: true
    };
  }
});

// ============================================================================
// STARTUP
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcpbridge] MCP Bridge Server v2.3.0 started');
}

main().catch((error) => {
  console.error('[mcpbridge] Fatal error:', error);
  process.exit(1);
});
