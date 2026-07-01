/**
 * ACP protocol handler - dispatches methods and handles errors
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorCode,
} from './types.js';
import { SessionManager } from '../session/session-manager.js';
import { BobShellBridge } from '../bridge/bob-shell-bridge.js';
import { StdioTransport } from '../transport/stdio-transport.js';
import { handleInitialize } from './methods/initialize.js';
import { handleSessionNew } from './methods/session-new.js';
import { handleSessionPrompt } from './methods/session-prompt.js';
import { handleSessionCancel } from './methods/session-cancel.js';
import { logger } from '../transport/logger.js';
import { AcpError, MethodNotFoundError } from '../utils/errors.js';
import {handleSessionSetMode} from "./methods/session-set-mode.js";

const COMPONENT = 'protocol-handler';

export class ProtocolHandler {
  private sessionManager: SessionManager;
  private bobShellBridge: BobShellBridge;
  private transport: StdioTransport;

  constructor(transport: StdioTransport) {
    this.transport = transport;
    this.sessionManager = new SessionManager();
    this.bobShellBridge = new BobShellBridge();
  }

  /**
   * Handle an incoming JSON-RPC request
   */
  async handleRequest(request: JsonRpcRequest): Promise<void> {
    logger.debug(COMPONENT, 'Handling request', {
      method: request.method,
      id: request.id,
    });

    const shouldRespond = request.id !== undefined;

    try {
      let response: JsonRpcResponse;

      switch (request.method) {
        case 'initialize':
          response = handleInitialize(request);
          break;

        case 'session/new':
          response = await handleSessionNew(request, this.sessionManager);
          break;

          case 'session/set_mode':
              response = await handleSessionSetMode(request, this.sessionManager);
              break;

        case 'session/prompt':
          response = await handleSessionPrompt(
            request,
            this.sessionManager,
            this.bobShellBridge,
            this.transport
          );
          break;

        case 'session/cancel':
          response = handleSessionCancel(request, this.sessionManager);
          break;

        case 'session/load':
          // Not implemented in v1
          throw new MethodNotFoundError(request.method);

        default:
          throw new MethodNotFoundError(request.method);
      }

      if (shouldRespond) {
        this.transport.sendResponse(response);
      }
    } catch (error) {
      logger.error(COMPONENT, 'Request handling failed', {
        method: request.method,
        id: request.id,
        error: String(error),
      });

      // Send error response
      if (shouldRespond) {
        const errorResponse = this.createErrorResponse(request, error);
        this.transport.sendResponse(errorResponse);
      }
    }
  }

  /**
   * Create an error response from an exception
   */
  private createErrorResponse(request: JsonRpcRequest, error: unknown): JsonRpcResponse {
    if (error instanceof AcpError) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: error.toJsonRpcError(),
      };
    }

    // Unknown error
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: JsonRpcErrorCode.InternalError,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * Cleanup all active processes (but keep sessions alive)
   * This is called during graceful shutdown to terminate running processes
   * while preserving session state for potential resumption
   */
  async cleanup(): Promise<void> {
    logger.info(COMPONENT, 'Cleaning up active processes', {
      sessionCount: this.sessionManager.getSessionCount(),
    });

    const sessionIds = this.sessionManager.getAllSessionIds();
    const cleanupPromises: Promise<void>[] = [];

    for (const sessionId of sessionIds) {
      const session = this.sessionManager.getSession(sessionId);
      if (session?.runningProcess) {
        cleanupPromises.push(
          new Promise<void>((resolve) => {
            const process = session.runningProcess!;
            const pid = process.pid;

            // Set a timeout for cleanup
            const timeout = setTimeout(() => {
              logger.warn(COMPONENT, 'Process cleanup timeout, forcing kill', {
                sessionId,
                pid,
              }, sessionId);
              try {
                if (pid) {
                  process.kill('SIGKILL');
                }
              } catch (error) {
                logger.error(COMPONENT, 'Failed to force kill process', {
                  sessionId,
                  error: String(error),
                }, sessionId);
              }
              resolve();
            }, 3000);

            // Listen for process exit
            process.once('exit', () => {
              clearTimeout(timeout);
              logger.debug(COMPONENT, 'Process exited during cleanup', {
                sessionId,
                pid,
              }, sessionId);
              resolve();
            });

            // Send SIGTERM
            try {
              process.kill('SIGTERM');
              logger.debug(COMPONENT, 'Sent SIGTERM to process', {
                sessionId,
                pid,
              }, sessionId);
            } catch (error) {
              clearTimeout(timeout);
              logger.warn(COMPONENT, 'Failed to send SIGTERM', {
                sessionId,
                error: String(error),
              }, sessionId);
              resolve();
            }
          })
        );
      }
    }

    // Wait for all processes to terminate
    await Promise.all(cleanupPromises);

    // Clear running process references (but keep sessions)
    for (const sessionId of sessionIds) {
      this.sessionManager.clearRunningProcess(sessionId);
    }

    logger.info(COMPONENT, 'Cleanup complete - processes terminated, sessions preserved');
  }

  /**
   * Get session manager (for testing)
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}

// Made with Bob
