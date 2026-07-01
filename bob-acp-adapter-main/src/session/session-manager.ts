/**
 * Session manager - tracks and manages ACP sessions
 */

import { v4 as uuidv4 } from 'uuid';
import { Session, createSession } from './session.js';
import { ChatMode, Message } from '../acp/types.js';
import { logger } from '../transport/logger.js';
import {McpServer} from "@agentclientprotocol/sdk";

const COMPONENT = 'session-manager';

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  /**
   * Create a new session
   */
  createSession(cwd: string, mode?: ChatMode, mcpServers?: McpServer[], bobSessionId?: string | null): Session {
    const sessionId = `sess_${uuidv4()}`;
    const session = createSession(sessionId, cwd, mode, mcpServers, bobSessionId ?? null);

    this.sessions.set(sessionId, session);

    logger.info(COMPONENT, 'Session created', {
      sessionId,
      cwd,
      mode: session.mode,
      bobSessionId: bobSessionId ?? 'pending'
    }, sessionId);

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Add a message to session history
   */
  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(COMPONENT, 'Cannot add message to non-existent session', { sessionId });
      return;
    }

    const message: Message = {
      role,
      content,
      timestamp: new Date(),
    };

    session.history.push(message);

    logger.debug(COMPONENT, 'Message added to history', {
      sessionId,
      role,
      contentLength: content.length
    }, sessionId);
  }

  /**
   * Set the running process for a session
   */
  setRunningProcess(sessionId: string, process: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(COMPONENT, 'Cannot set process for non-existent session', { sessionId });
      return;
    }

    session.runningProcess = process;
    logger.debug(COMPONENT, 'Running process set', { sessionId }, sessionId);
  }

  /**
   * Clear the running process for a session
   */
  clearRunningProcess(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.runningProcess = null;
    logger.debug(COMPONENT, 'Running process cleared', { sessionId }, sessionId);
  }

  /**
   * Set the Bob Shell session index for a session
   */
  setBobSessionId(sessionId: string, bobSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(COMPONENT, 'Cannot set Bob session id for non-existent session', { sessionId });
      return;
    }

    session.bobSessionId = bobSessionId;
    logger.debug(COMPONENT, 'Bob session id set', { sessionId, bobSessionId }, sessionId);
  }

  /**
   * Increment the turn counter for a session (called when starting a new prompt)
   */
  incrementTurnCounter(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(COMPONENT, 'Cannot increment turn counter for non-existent session', { sessionId });
      return 0;
    }

    session.turnCounter++;
    logger.debug(COMPONENT, 'Turn counter incremented', { sessionId, turnCounter: session.turnCounter }, sessionId);
    return session.turnCounter;
  }

  /**
   * Get the current turn counter for a session
   */
  getTurnCounter(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return 0;
    }
    return session.turnCounter;
  }

  /**
   * Generate a unique tool ID by prefixing Bob's tool ID with the turn counter
   */
  generateUniqueToolId(sessionId: string, bobToolId: string): string {
    const turnCounter = this.getTurnCounter(sessionId);
    return `turn${turnCounter}_${bobToolId}`;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Kill running process if any
    if (session.runningProcess) {
      try {
        session.runningProcess.kill('SIGTERM');
      } catch (error) {
        logger.warn(COMPONENT, 'Failed to kill process during session deletion', {
          sessionId,
          error: String(error)
        }, sessionId);
      }
    }

    this.sessions.delete(sessionId);
    logger.info(COMPONENT, 'Session deleted', { sessionId }, sessionId);

    return true;
  }

  /**
   * Get all session IDs
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up old sessions (optional, for memory management)
   */
  cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.createdAt.getTime();
      if (age > maxAgeMs && !session.runningProcess) {
        this.deleteSession(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(COMPONENT, 'Cleaned up old sessions', { count: cleaned });
    }

    return cleaned;
  }
}

// Made with Bob
