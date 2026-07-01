/**
 * Stdio transport for JSON-RPC communication
 * Reads from stdin, writes to stdout, logs to stderr
 */

import { createInterface } from 'readline';
import { JsonRpcErrorCode, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '../acp/types.js';
import { logger } from './logger.js';

const COMPONENT = 'stdio-transport';

export class StdioTransport {
  private readline = createInterface({
    input: process.stdin,
    terminal: false,
  });

  /**
   * Start reading messages from stdin
   */
  start(onMessage: (message: JsonRpcRequest) => void): void {
    logger.info(COMPONENT, 'Starting stdio transport');

    this.readline.on('line', (line: string) => {
      this.handleLine(line, onMessage);
    });

    this.readline.on('close', () => {
      logger.info(COMPONENT, 'Stdin closed, shutting down');
      process.exit(0);
    });
  }

  private handleLine(line: string, onMessage: (message: JsonRpcRequest) => void): void {
    const trimmed = line.trim();

    try {
      if (!trimmed) {
        return; // Skip empty lines
      }

      const message = JSON.parse(trimmed);

      // Validate it's a JSON-RPC request
      if (!this.isValidJsonRpcRequest(message)) {
        logger.warn(COMPONENT, 'Received invalid JSON-RPC message', { message });
        return;
      }

      // Keep INFO logs concise; full payload remains available in DEBUG logs.
      logger.info(COMPONENT, 'Received JSON-RPC request', {
        method: message.method,
        id: message.id,
      });

      logger.debug(COMPONENT, 'Received message', {
        method: message.method,
        id: message.id,
        params: message.params,
        fullRequest: message
      });
      onMessage(message);
    } catch (error) {
      logger.error(COMPONENT, 'Failed to parse message', { error: String(error), line });

      // Some hosts may emit non-JSON noise lines; only emit ParseError for JSON-like payloads.
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        this.sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JsonRpcErrorCode.ParseError,
            message: 'Invalid JSON payload',
          },
        });
      }
    }
  }

  /**
   * Send a JSON-RPC response to stdout
   */
  sendResponse(response: JsonRpcResponse): void {
    this.writeToStdout(response);
  }

  /**
   * Send a JSON-RPC notification to stdout
   */
  sendNotification(notification: JsonRpcNotification): void {
    this.writeToStdout(notification);
  }

  /**
   * Write JSON to stdout and flush
   * CRITICAL: Only JSON-RPC messages should go to stdout
   */
  private writeToStdout(message: JsonRpcResponse | JsonRpcNotification): void {
    try {
      const json = JSON.stringify(message);
      process.stdout.write(json + '\n');
      
      // Flush to ensure immediate delivery
      if (process.stdout.write('')) {
        // Write succeeded
      }
      
      logger.debug(COMPONENT, 'Sent message', { 
        method: 'method' in message ? message.method : 'response',
        id: 'id' in message ? message.id : undefined 
      });
    } catch (error) {
      logger.error(COMPONENT, 'Failed to write to stdout', { error: String(error) });
    }
  }

  /**
   * Validate JSON-RPC request structure
   */
  private isValidJsonRpcRequest(message: unknown): message is JsonRpcRequest {
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    const msg = message as Record<string, unknown>;
    
    return (
      msg.jsonrpc === '2.0' &&
      typeof msg.method === 'string' &&
      (msg.id === undefined || typeof msg.id === 'string' || typeof msg.id === 'number')
    );
  }

  /**
   * Stop the transport
   */
  stop(): void {
    logger.info(COMPONENT, 'Stopping stdio transport');
    this.readline.close();
  }
}

// Made with Bob
