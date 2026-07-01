/**
 * Handle ACP session/cancel method
 */

import {
  SessionCancelParams,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../types.js';
import { SessionManager } from '../../session/session-manager.js';
import { logger } from '../../transport/logger.js';
import { SessionNotFoundError, InvalidParamsError } from '../../utils/errors.js';

const COMPONENT = 'session-cancel-handler';

export function handleSessionCancel(
  request: JsonRpcRequest,
  sessionManager: SessionManager
): JsonRpcResponse {
  const params = request.params as SessionCancelParams;

  // Validate required parameters
  if (!params || !params.sessionId) {
    throw new InvalidParamsError('Missing required parameter: sessionId');
  }

  const session = sessionManager.getSession(params.sessionId);
  if (!session) {
    throw new SessionNotFoundError(params.sessionId);
  }

  logger.info(COMPONENT, 'Cancelling session', { sessionId: params.sessionId }, params.sessionId);

  // Kill running process if any
  if (session.runningProcess) {
    try {
      session.runningProcess.kill('SIGTERM');
      logger.info(COMPONENT, 'Sent SIGTERM to running process', { 
        sessionId: params.sessionId,
        pid: session.runningProcess.pid 
      }, params.sessionId);
    } catch (error) {
      logger.error(COMPONENT, 'Failed to kill process', { 
        sessionId: params.sessionId,
        error: String(error) 
      }, params.sessionId);
    }
  }

  // Clear the running process reference
  sessionManager.clearRunningProcess(params.sessionId);

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: null,
  };
}

// Made with Bob
