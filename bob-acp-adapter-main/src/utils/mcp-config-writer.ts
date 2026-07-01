/**
 * MCP configuration writer - creates .bob/mcp.json for Bob Shell
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { McpServerConfig } from '../acp/types.js';
import { logger } from '../transport/logger.js';
import {McpServer} from "@agentclientprotocol/sdk";

const COMPONENT = 'mcp-config-writer';

/**
 * Bob Shell MCP configuration format
 */
interface BobMcpConfig {
  mcpServers: Record<string, BobMcpServerConfig>;
}

interface BobMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  httpURL?: string;
  headers?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  alwaysAllow?: string[];
  disabled?: boolean;
}

/**
 * Convert IntelliJ MCP server config to Bob Shell format
 */
function convertToBobFormat(config: McpServer): BobMcpServerConfig {
  const bobConfig: BobMcpServerConfig = {};

  const mcpServerConfig = config as McpServerConfig;

  // Handle stdio transport (most common from IntelliJ)
  if (mcpServerConfig.command) {
    bobConfig.command = mcpServerConfig.command;
  }

  if (mcpServerConfig.args && mcpServerConfig.args.length > 0) {
    bobConfig.args = mcpServerConfig.args;
  }

  // Convert env from array format to object format if needed
  if (mcpServerConfig.env) {
    if (Array.isArray(mcpServerConfig.env)) {
      bobConfig.env = {};
      for (const envVar of mcpServerConfig.env) {
        bobConfig.env[envVar.name] = envVar.value;
      }
    } else {
      bobConfig.env = mcpServerConfig.env;
    }
  }

  // Handle SSE transport
  if (mcpServerConfig.url) {
    bobConfig.url = mcpServerConfig.url;
  }

  // Handle HTTP transport
  if (mcpServerConfig.httpURL) {
    bobConfig.httpURL = mcpServerConfig.httpURL;
  }

  // Optional fields
  if (mcpServerConfig.headers) {
    bobConfig.headers = mcpServerConfig.headers;
  }

  if (mcpServerConfig.cwd) {
    bobConfig.cwd = mcpServerConfig.cwd;
  }

  if (mcpServerConfig.timeout) {
    bobConfig.timeout = mcpServerConfig.timeout;
  }

  if (mcpServerConfig.alwaysAllow) {
    bobConfig.alwaysAllow = mcpServerConfig.alwaysAllow;
  }

  if (mcpServerConfig.disabled !== undefined) {
    bobConfig.disabled = mcpServerConfig.disabled;
  }

  return bobConfig;
}

/**
 * Write MCP configuration to .bob/mcp.json
 */
export async function writeMcpConfig(
  cwd: string,
  mcpServers: McpServer[],
  sessionId?: string
): Promise<void> {
  if (!mcpServers || mcpServers.length === 0) {
    logger.debug(COMPONENT, 'No MCP servers to configure', { cwd }, sessionId);
    return;
  }

  try {
    // Create .bob directory if it doesn't exist
    const bobDir = join(cwd, '.bob');
    await fs.mkdir(bobDir, { recursive: true });

    // Convert servers to Bob format
    const bobConfig: BobMcpConfig = {
      mcpServers: {},
    };

    for (const server of mcpServers) {
      if (!server.name) {
        logger.warn(COMPONENT, 'Skipping MCP server without name', { cwd }, sessionId);
        continue;
      }

      bobConfig.mcpServers[server.name] = convertToBobFormat(server);
    }

    // Write config file
    const configPath = join(bobDir, 'mcp.json');
    const configJson = JSON.stringify(bobConfig, null, 2);
    await fs.writeFile(configPath, configJson, 'utf-8');

    logger.info(COMPONENT, 'MCP configuration written', {
      cwd,
      configPath,
      serverCount: mcpServers.length,
      serverNames: mcpServers.map(s => s.name),
    }, sessionId);
  } catch (error) {
    logger.error(COMPONENT, 'Failed to write MCP configuration', {
      cwd,
      error: String(error),
    }, sessionId);
    throw error;
  }
}

/**
 * Check if .bob/mcp.json exists
 */
export async function mcpConfigExists(cwd: string): Promise<boolean> {
  try {
    const configPath = join(cwd, '.bob', 'mcp.json');
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read existing MCP configuration
 */
export async function readMcpConfig(cwd: string): Promise<BobMcpConfig | null> {
  try {
    const configPath = join(cwd, '.bob', 'mcp.json');
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.debug(COMPONENT, 'Could not read MCP config', {
      cwd,
      error: String(error),
    });
    return null;
  }
}

// Made with Bob
