/**
 * Handle ACP initialize method
 */

import { 
  InitializeParams, 
  InitializeResult,
  JsonRpcRequest,
  JsonRpcResponse 
} from '../types.js';
import { logger } from '../../transport/logger.js';

const COMPONENT = 'initialize-handler';
const VERSION = '0.1.1';

export function handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
  const params = request.params as InitializeParams;
  
  logger.info(COMPONENT, 'Initializing ACP adapter', {
    clientName: params?.clientInfo?.name,
    clientVersion: params?.clientInfo?.version,
  });

  const result: InitializeResult = {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: false,  // v1: no session persistence
      mcpCapabilities: {
        http: false,       // v1: no HTTP MCP support
        sse: false,        // v1: no SSE MCP support
      },
    },
    agentInfo: {
      name: 'Bob Shell ACP Adapter',
      version: VERSION,
    },
  };

  logger.info(COMPONENT, 'Initialization complete', { version: VERSION });

  return {
    jsonrpc: '2.0',
    id: request.id,
    result,
  };
}

// Made with Bob
