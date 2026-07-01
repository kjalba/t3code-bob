/**
 * Session state model
 */

import { ChildProcess } from 'child_process';
import { ChatMode, Message } from '../acp/types.js';
import {McpServer} from "@agentclientprotocol/sdk";

export interface Session {
  id: string;
  cwd: string;
  mode: ChatMode;
  mcpServers: McpServer[];
  history: Message[];
  runningProcess: ChildProcess | null;
  createdAt: Date;
  bobSessionId: string | null; // Bob Shell session identifier for resumption
  turnCounter: number; // Counter for making tool IDs unique across turns
  activeToolCalls: Map<string, string>; // Map of tool call ID to tool name for result mapping
}

export function createSession(
  id: string,
  cwd: string,
  mode: ChatMode = 'code',
  mcpServers: McpServer[] = [],
  bobSessionId: string | null = null
): Session {
  return {
    id,
    cwd,
    mode,
    mcpServers,
    history: [],
    runningProcess: null,
    createdAt: new Date(),
    bobSessionId,
    turnCounter: 0,
    activeToolCalls: new Map(),
  };
}

// Made with Bob
