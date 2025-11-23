#!/usr/bin/env node
/**
 * Test client for MCP Bridge Server
 *
 * Usage:
 *   node test-client.js                           # Run all tests
 *   node test-client.js list-servers              # Test list_servers
 *   node test-client.js list-tools <server>       # Test list_mcp_tools
 *   node test-client.js call <server> <tool> '{}'  # Test call_mcp_tool
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createClient() {
  const client = new Client({
    name: 'mcpbridge-test-client',
    version: '1.0.0'
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(__dirname, 'bridge-server.js')],
    env: process.env
  });

  await client.connect(transport);
  return client;
}

async function testListServers(client) {
  console.log('\n--- Testing list_servers ---');
  const result = await client.callTool({
    name: 'list_servers',
    arguments: {}
  });
  console.log(result.content[0].text);
  return result;
}

async function testListTools(client, serverName) {
  console.log(`\n--- Testing list_mcp_tools(${serverName}) ---`);
  const result = await client.callTool({
    name: 'list_mcp_tools',
    arguments: { server: serverName }
  });
  console.log(result.content[0].text);
  return result;
}

async function testCallTool(client, serverName, toolName, args) {
  console.log(`\n--- Testing call_mcp_tool(${serverName}, ${toolName}) ---`);
  const result = await client.callTool({
    name: 'call_mcp_tool',
    arguments: {
      server: serverName,
      tool: toolName,
      arguments: args
    }
  });
  console.log(result.content[0].text);
  return result;
}

async function runAllTests(client) {
  console.log('=== MCP Bridge Test Suite ===\n');

  // Test 1: List servers
  await testListServers(client);

  // Test 2: List tools from context7 (usually available without auth)
  try {
    await testListTools(client, 'context7');
  } catch (e) {
    console.log(`Error listing context7 tools: ${e.message}`);
  }

  console.log('\n=== Tests Complete ===');
}

async function main() {
  const [,, command, ...args] = process.argv;

  let client;
  try {
    console.log('Connecting to MCP Bridge...');
    client = await createClient();
    console.log('Connected!\n');

    // List available tools from bridge
    const toolsResult = await client.listTools();
    console.log('Bridge exposes these tools:');
    toolsResult.tools.forEach(t => {
      console.log(`  - ${t.name}: ${(t.description || '').slice(0, 60)}...`);
    });

    switch (command) {
      case 'list-servers':
        await testListServers(client);
        break;

      case 'list-tools':
        if (!args[0]) {
          console.error('Usage: test-client.js list-tools <server>');
          process.exit(1);
        }
        await testListTools(client, args[0]);
        break;

      case 'call':
        if (args.length < 2) {
          console.error('Usage: test-client.js call <server> <tool> [json-args]');
          process.exit(1);
        }
        const [serverName, toolName, jsonArgs] = args;
        const parsedArgs = jsonArgs ? JSON.parse(jsonArgs) : {};
        await testCallTool(client, serverName, toolName, parsedArgs);
        break;

      default:
        await runAllTests(client);
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();
