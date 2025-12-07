#!/usr/bin/env node
/**
 * MCP Bridge Server v2.0 - Context Engineering Edition
 *
 * Implements Anthropic's "Code Execution with MCP" pattern with Manus-style
 * context engineering: compaction, summarization, and result offloading.
 *
 * Features:
 * - Result compaction: Large results stored externally, returns references
 * - Auto-summarization: Summarizes large results for context efficiency
 * - Result store: Fetch full results on demand
 * - Tool caching: 5-minute TTL for tool schemas
 * - Retry logic: Exponential backoff with jitter
 * - Health checks: Monitor server connectivity
 *
 * @author mwilliams
 * @version 2.0.0
 * @license MIT
 * @see https://www.anthropic.com/engineering/code-execution-with-mcp
 * @see https://rlancemartin.github.io/2025/10/15/manus/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

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
  toolsCacheTtlMs: 300000, // 5 minutes
  resultsCacheTtlMs: 600000, // 10 minutes
  // Compaction settings
  compaction: {
    enabled: true,
    thresholdBytes: 2000, // Compact results larger than 2KB
    thresholdRows: 20, // Compact arrays with more than 20 items
    maxPreviewLength: 500, // Max chars in preview
    maxPreviewRows: 5 // Max rows in array preview
  }
};

// ============================================================================
// RESULT STORE (Manus-style context offloading)
// ============================================================================

const resultStore = new Map(); // In-memory store: resultId -> { full, compact, createdAt }
let resultCounter = 0;

/**
 * Generate a unique result ID
 */
function generateResultId(serverName, toolName) {
  const timestamp = Date.now().toString(36);
  const counter = (resultCounter++).toString(36);
  return `${serverName}_${toolName}_${timestamp}_${counter}`;
}

/**
 * Calculate size of content in bytes
 */
function getContentSize(content) {
  return Buffer.byteLength(JSON.stringify(content), 'utf8');
}

/**
 * Check if result should be compacted
 */
function shouldCompact(content) {
  if (!CONFIG.compaction.enabled) return false;
  
  const size = getContentSize(content);
  if (size > CONFIG.compaction.thresholdBytes) return true;
  
  // Check for large arrays in the content
  if (Array.isArray(content) && content.length > CONFIG.compaction.thresholdRows) return true;
  if (typeof content === 'object' && content !== null) {
    for (const value of Object.values(content)) {
      if (Array.isArray(value) && value.length > CONFIG.compaction.thresholdRows) return true;
    }
  }
  
  return false;
}

/**
 * Generate a compact preview of content
 */
function generatePreview(content) {
  if (typeof content === 'string') {
    if (content.length > CONFIG.compaction.maxPreviewLength) {
      return content.slice(0, CONFIG.compaction.maxPreviewLength) + '... [truncated]';
    }
    return content;
  }
  
  if (Array.isArray(content)) {
    const preview = content.slice(0, CONFIG.compaction.maxPreviewRows);
    return {
      _preview: true,
      total_items: content.length,
      showing: preview.length,
      items: preview,
      _note: `Use get_result("ID") to fetch all ${content.length} items`
    };
  }
  
  if (typeof content === 'object' && content !== null) {
    const preview = {};
    for (const [key, value] of Object.entries(content)) {
      if (Array.isArray(value) && value.length > CONFIG.compaction.maxPreviewRows) {
        preview[key] = {
          _preview: true,
          total_items: value.length,
          showing: CONFIG.compaction.maxPreviewRows,
          items: value.slice(0, CONFIG.compaction.maxPreviewRows)
        };
      } else if (typeof value === 'string' && value.length > CONFIG.compaction.maxPreviewLength) {
        preview[key] = value.slice(0, CONFIG.compaction.maxPreviewLength) + '... [truncated]';
      } else {
        preview[key] = value;
      }
    }
    return preview;
  }
  
  return content;
}

/**
 * Generate a summary of the result
 */
function generateSummary(content, serverName, toolName) {
  const size = getContentSize(content);
  const summary = {
    server: serverName,
    tool: toolName,
    size_bytes: size,
    size_human: size > 1024 ? `${(size/1024).toFixed(1)}KB` : `${size}B`
  };
  
  if (Array.isArray(content)) {
    summary.type = 'array';
    summary.item_count = content.length;
  } else if (typeof content === 'object' && content !== null) {
    summary.type = 'object';
    summary.keys = Object.keys(content);
    // Check for common patterns
    if (content.rows) summary.row_count = content.rows.length;
    if (content.data) summary.data_count = Array.isArray(content.data) ? content.data.length : 1;
    if (content.results) summary.results_count = Array.isArray(content.results) ? content.results.length : 1;
  } else {
    summary.type = typeof content;
  }
  
  return summary;
}

/**
 * Store a result and return compact version if needed
 */
function storeResult(content, serverName, toolName) {
  const resultId = generateResultId(serverName, toolName);
  const needsCompaction = shouldCompact(content);
  
  if (needsCompaction) {
    const preview = generatePreview(content);
    const summary = generateSummary(content, serverName, toolName);
    
    // Store full result
    resultStore.set(resultId, {
      full: content,
      summary,
      createdAt: Date.now()
    });
    
    console.error(`[mcpbridge] Stored result ${resultId} (${summary.size_human})`);
    
    // Return compact version
    return {
      compacted: true,
      result_id: resultId,
      summary,
      preview,
      _hint: `Full result stored. Use get_result("${resultId}") to retrieve.`
    };
  }
  
  // Small result - return as-is
  return {
    compacted: false,
    data: content
  };
}

/**
 * Retrieve a stored result
 */
function getStoredResult(resultId) {
  const stored = resultStore.get(resultId);
  if (!stored) {
    return { error: `Result ${resultId} not found. It may have expired.` };
  }
  
  const age = Date.now() - stored.createdAt;
  if (age > CONFIG.resultsCacheTtlMs) {
    resultStore.delete(resultId);
    return { error: `Result ${resultId} expired after ${CONFIG.resultsCacheTtlMs/1000}s.` };
  }
  
  return {
    result_id: resultId,
    age_seconds: Math.round(age / 1000),
    data: stored.full
  };
}

/**
 * Clean up expired results
 */
function cleanupExpiredResults() {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, stored] of resultStore) {
    if (now - stored.createdAt > CONFIG.resultsCacheTtlMs) {
      resultStore.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.error(`[mcpbridge] Cleaned up ${cleaned} expired results`);
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredResults, 60000);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(attempt) {
  const exponentialDelay = CONFIG.retry.baseDelayMs * Math.pow(CONFIG.retry.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, CONFIG.retry.maxDelayMs);
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
}

async function withRetry(operation, operationName, serverName) {
  let lastError;
  
  for (let attempt = 0; attempt <= CONFIG.retry.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      const isRetryable = isRetryableError(error);
      const hasRetriesLeft = attempt < CONFIG.retry.maxRetries;
      
      if (isRetryable && hasRetriesLeft) {
        const delay = getRetryDelay(attempt);
        console.error(`[mcpbridge] ${operationName} failed for ${serverName} (attempt ${attempt + 1}/${CONFIG.retry.maxRetries + 1}): ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
        
        if (isConnectionError(error)) {
          clientCache.delete(serverName);
        }
      } else {
        break;
      }
    }
  }
  
  throw lastError;
}

function isRetryableError(error) {
  const message = error.message?.toLowerCase() || '';
  return (
    isConnectionError(error) ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND'
  );
}

function isConnectionError(error) {
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('connect') ||
    message.includes('spawn') ||
    message.includes('enoent') ||
    message.includes('not found') ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOENT'
  );
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

function loadConfig() {
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

  return {
    context7: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@latest'],
      description: 'Up-to-date library documentation',
      enabled: true
    }
  };
}

const SERVERS = loadConfig();
const enabledServers = Object.entries(SERVERS)
  .filter(([_, config]) => config.enabled !== false)
  .map(([name]) => name);

// ============================================================================
// CLIENT MANAGEMENT
// ============================================================================

const clientCache = new Map();
const clientStatus = new Map();
const toolsCache = new Map();

async function getClient(serverName) {
  if (clientCache.has(serverName)) {
    return clientCache.get(serverName);
  }

  const config = SERVERS[serverName];
  if (!config) {
    throw new Error(`Unknown server: ${serverName}. Available: ${enabledServers.join(', ')}`);
  }

  if (config.enabled === false) {
    throw new Error(`Server ${serverName} is disabled.`);
  }

  if (config.type !== 'stdio') {
    throw new Error(`Server ${serverName} uses ${config.type} transport. Only stdio supported.`);
  }

  return await withRetry(async () => {
    const client = new Client({ name: 'mcpbridge-client', version: '2.0.0' }, { capabilities: {} });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...(config.env || {}) }
    });

    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Connection timeout after ${CONFIG.connectionTimeoutMs}ms`)), CONFIG.connectionTimeoutMs)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    
    clientCache.set(serverName, client);
    clientStatus.set(serverName, { connected: true, lastConnected: new Date().toISOString() });
    console.error(`[mcpbridge] Connected to ${serverName}`);
    return client;
  }, 'Connection', serverName);
}

async function executeToolCall(serverName, toolName, toolArgs) {
  return await withRetry(async () => {
    const client = await getClient(serverName);
    return await client.callTool({ name: toolName, arguments: toolArgs });
  }, `Tool call ${toolName}`, serverName);
}

async function listServerTools(serverName, bypassCache = false) {
  if (!bypassCache && toolsCache.has(serverName)) {
    const cached = toolsCache.get(serverName);
    const age = Date.now() - cached.cachedAt;
    if (age < CONFIG.toolsCacheTtlMs) {
      console.error(`[mcpbridge] Using cached tools for ${serverName} (age: ${Math.round(age/1000)}s)`);
      return { tools: cached.tools };
    }
  }

  const result = await withRetry(async () => {
    const client = await getClient(serverName);
    return await client.listTools();
  }, 'List tools', serverName);

  toolsCache.set(serverName, {
    tools: result.tools,
    cachedAt: Date.now()
  });
  console.error(`[mcpbridge] Cached ${result.tools.length} tools for ${serverName}`);

  return result;
}

// ============================================================================
// TOOL DEFINITIONS
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
        refresh: {
          type: 'boolean',
          description: 'Bypass cache and fetch fresh tools list (default: false)'
        },
        verbose: {
          type: 'boolean',
          description: 'Include descriptions (default: false for minimal context)'
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
    description: `Call any tool from any MCP server. Large results (>2KB) are automatically compacted - use get_result(id) to fetch full data. Available servers: ${enabledServers.join(', ')}`,
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
        },
        compact: {
          type: 'boolean',
          description: 'Force compaction even for small results (default: auto based on size)'
        }
      },
      required: ['server', 'tool']
    }
  },
  {
    name: 'get_result',
    description: 'Retrieve a full result that was previously compacted. Results expire after 10 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        result_id: {
          type: 'string',
          description: 'The result_id from a compacted call_mcp_tool response'
        }
      },
      required: ['result_id']
    }
  },
  {
    name: 'list_results',
    description: 'List all stored results with their IDs, summaries, and ages.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
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
    description: 'Get bridge statistics: connected servers, cached tools, stored results, memory usage.',
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
  { name: 'mcp-bridge', version: '2.1.0' },
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
          status: clientStatus.get(name) || { connected: false }
        }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ servers, count: servers.length }, null, 2)
        }]
      };
    }

    // ========== list_mcp_tools ==========
    if (name === 'list_mcp_tools') {
      const serverName = args?.server;
      const refresh = args?.refresh === true;
      const verbose = args?.verbose === true;
      if (!serverName) {
        throw new Error('server parameter required. Available: ' + enabledServers.join(', '));
      }
      
      const result = await listServerTools(serverName, refresh);
      
      // Minimal mode: just tool names (saves ~80% context)
      if (!verbose) {
        const toolNames = result.tools.map(t => t.name);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ 
              server: serverName, 
              tool_count: toolNames.length,
              tools: toolNames,
              _hint: 'Use get_tool_schema(server, tool) for full schema of a specific tool'
            }, null, 2)
          }]
        };
      }
      
      // Verbose mode: names + short descriptions
      const tools = result.tools.map(t => ({
        name: t.name,
        description: (t.description || '').slice(0, 100)
      }));

      const cached = toolsCache.get(serverName);
      const cacheAge = cached ? Math.round((Date.now() - cached.cachedAt) / 1000) : 0;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ 
            server: serverName, 
            tool_count: tools.length, 
            cached: !refresh && cacheAge > 0,
            cache_age_seconds: cacheAge,
            tools 
          }, null, 2)
        }]
      };
    }

    // ========== get_tool_schema (NEW - lazy loading) ==========
    if (name === 'get_tool_schema') {
      const serverName = args?.server;
      const toolName = args?.tool;
      
      if (!serverName) {
        throw new Error('server parameter required. Available: ' + enabledServers.join(', '));
      }
      if (!toolName) {
        throw new Error('tool parameter required');
      }
      
      const result = await listServerTools(serverName, false);
      const tool = result.tools.find(t => t.name === toolName);
      
      if (!tool) {
        const availableTools = result.tools.map(t => t.name).join(', ');
        throw new Error(`Tool "${toolName}" not found in ${serverName}. Available: ${availableTools}`);
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: serverName,
            tool: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }, null, 2)
        }]
      };
    }

    // ========== call_mcp_tool (with compaction) ==========
    if (name === 'call_mcp_tool') {
      const serverName = args?.server;
      const toolName = args?.tool;
      const toolArgs = args?.arguments || {};
      const forceCompact = args?.compact === true;

      if (!serverName) {
        throw new Error('server parameter required. Available: ' + enabledServers.join(', '));
      }
      if (!toolName) {
        throw new Error('tool parameter required. Use list_mcp_tools("' + serverName + '") to see available tools.');
      }

      const result = await executeToolCall(serverName, toolName, toolArgs);
      const elapsed = Date.now() - startTime;
      console.error(`[mcpbridge] ${serverName}.${toolName} completed in ${elapsed}ms`);

      // Extract content for compaction
      let content = result;
      if (result.content && result.content.length > 0) {
        // Try to parse text content as JSON
        const textContent = result.content.find(c => c.type === 'text');
        if (textContent) {
          try {
            content = JSON.parse(textContent.text);
          } catch {
            content = textContent.text;
          }
        }
      }

      // Apply compaction if needed
      const shouldForceCompact = forceCompact || shouldCompact(content);
      if (shouldForceCompact) {
        const compacted = storeResult(content, serverName, toolName);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...compacted,
              elapsed_ms: elapsed
            }, null, 2)
          }]
        };
      }

      // Return as-is for small results
      if (result.content && result.content.length > 0) {
        return { content: result.content };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // ========== get_result ==========
    if (name === 'get_result') {
      const resultId = args?.result_id;
      if (!resultId) {
        throw new Error('result_id parameter required');
      }
      
      const result = getStoredResult(resultId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    // ========== list_results ==========
    if (name === 'list_results') {
      const results = [];
      const now = Date.now();
      
      for (const [id, stored] of resultStore) {
        const age = Math.round((now - stored.createdAt) / 1000);
        const ttlRemaining = Math.round((CONFIG.resultsCacheTtlMs - (now - stored.createdAt)) / 1000);
        
        results.push({
          result_id: id,
          summary: stored.summary,
          age_seconds: age,
          expires_in_seconds: Math.max(0, ttlRemaining)
        });
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            stored_results: results.length,
            results
          }, null, 2)
        }]
      };
    }

    // ========== check_server_health ==========
    if (name === 'check_server_health') {
      const serverName = args?.server;
      const serversToCheck = serverName ? [serverName] : enabledServers;
      const results = [];

      for (const srv of serversToCheck) {
        const healthStart = Date.now();
        const status = {
          server: srv,
          description: SERVERS[srv]?.description || 'No description',
          healthy: false,
          response_time_ms: 0,
          tool_count: 0,
          cached_connection: clientCache.has(srv),
          error: null
        };

        try {
          const toolsResult = await listServerTools(srv, false);
          status.healthy = true;
          status.tool_count = toolsResult.tools.length;
          status.response_time_ms = Date.now() - healthStart;
          
          const connStatus = clientStatus.get(srv);
          if (connStatus) {
            status.last_connected = connStatus.lastConnected;
          }
        } catch (error) {
          status.healthy = false;
          status.error = error.message;
          status.response_time_ms = Date.now() - healthStart;
        }

        results.push(status);
      }

      const summary = {
        total: results.length,
        healthy: results.filter(r => r.healthy).length,
        unhealthy: results.filter(r => !r.healthy).length,
        total_response_time_ms: results.reduce((sum, r) => sum + r.response_time_ms, 0)
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ summary, servers: results }, null, 2)
        }]
      };
    }

    // ========== get_bridge_stats ==========
    if (name === 'get_bridge_stats') {
      const stats = {
        version: '2.1.0',
        uptime_seconds: Math.round(process.uptime()),
        servers: {
          configured: Object.keys(SERVERS).length,
          enabled: enabledServers.length,
          connected: clientCache.size
        },
        caches: {
          tools_cached: toolsCache.size,
          tools_ttl_seconds: CONFIG.toolsCacheTtlMs / 1000,
          results_stored: resultStore.size,
          results_ttl_seconds: CONFIG.resultsCacheTtlMs / 1000
        },
        compaction: {
          enabled: CONFIG.compaction.enabled,
          threshold_bytes: CONFIG.compaction.thresholdBytes,
          threshold_rows: CONFIG.compaction.thresholdRows
        },
        memory: {
          heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
          heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100
        }
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(stats, null, 2)
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[mcpbridge] Error after ${elapsed}ms: ${error.message}`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: error.message,
          server: args?.server,
          tool: args?.tool || name,
          elapsed_ms: elapsed,
          hint: getErrorHint(error, args)
        }, null, 2)
      }],
      isError: true
    };
  }
});

function getErrorHint(error, args) {
  const message = error.message?.toLowerCase() || '';
  
  if (message.includes('unknown server')) {
    return `Available servers: ${enabledServers.join(', ')}`;
  }
  if (message.includes('timeout')) {
    return 'Server took too long to respond. It may be starting up - try again.';
  }
  if (message.includes('enoent') || message.includes('spawn')) {
    return 'Server command not found. Check if the package is installed.';
  }
  if (message.includes('connect')) {
    return 'Connection failed after retries. Server may be unavailable.';
  }
  if (message.includes('not found') && message.includes('result')) {
    return 'Result expired or invalid. Use list_results() to see available results.';
  }
  if (args?.server) {
    return `Use list_mcp_tools("${args.server}") to see available tools and their parameters.`;
  }
  return 'Use list_servers() to see available servers.';
}

// ============================================================================
// LIFECYCLE
// ============================================================================

process.on('SIGINT', async () => {
  console.error('[mcpbridge] Shutting down...');
  for (const [name, client] of clientCache) {
    try {
      await client.close();
      console.error(`[mcpbridge] Closed connection to ${name}`);
    } catch (e) {}
  }
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(`[mcpbridge] Uncaught exception: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[mcpbridge] Unhandled rejection: ${reason}`);
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcpbridge] MCP Bridge Server v2.1.0 started');
console.error(`[mcpbridge] Enabled servers: ${enabledServers.join(', ')}`);
console.error(`[mcpbridge] Compaction: ${CONFIG.compaction.enabled ? 'ON' : 'OFF'} (threshold: ${CONFIG.compaction.thresholdBytes}B / ${CONFIG.compaction.thresholdRows} rows)`);
console.error(`[mcpbridge] Tools cache TTL: ${CONFIG.toolsCacheTtlMs / 1000}s | Results cache TTL: ${CONFIG.resultsCacheTtlMs / 1000}s`);
