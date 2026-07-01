/**
 * Custom error classes for the ACP adapter
 */

import { JsonRpcError, JsonRpcErrorCode } from '../acp/types.js';

export class AcpError extends Error {
  constructor(
    message: string,
    public code: JsonRpcErrorCode,
    public data?: unknown
  ) {
    super(message);
    this.name = 'AcpError';
  }

  toJsonRpcError(): JsonRpcError {
    const error: JsonRpcError = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) {
      error.data = this.data;
    }
    return error;
  }
}

export class SessionNotFoundError extends AcpError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, JsonRpcErrorCode.SessionNotFound, { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

export class SecurityViolationError extends AcpError {
  constructor(message: string, details?: unknown) {
    super(message, JsonRpcErrorCode.SecurityViolation, details);
    this.name = 'SecurityViolationError';
  }
}

export class InvalidParamsError extends AcpError {
  constructor(message: string, details?: unknown) {
    super(message, JsonRpcErrorCode.InvalidParams, details);
    this.name = 'InvalidParamsError';
  }
}

export class SessionBusyError extends AcpError {
  constructor(sessionId: string) {
    super(`Session is busy: ${sessionId}`, JsonRpcErrorCode.SessionBusy, { sessionId });
    this.name = 'SessionBusyError';
  }
}

export class MethodNotFoundError extends AcpError {
  constructor(method: string) {
    super(`Method not found: ${method}`, JsonRpcErrorCode.MethodNotFound, { method });
    this.name = 'MethodNotFoundError';
  }
}

export class InternalError extends AcpError {
  constructor(message: string, details?: unknown) {
    super(message, JsonRpcErrorCode.InternalError, details);
    this.name = 'InternalError';
  }
}

// Made with Bob
