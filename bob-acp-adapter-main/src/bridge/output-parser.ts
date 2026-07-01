/**
 * Parser for Bob Shell stream-json output
 * Updated to match actual Bob Shell format
 */

import { logger } from '../transport/logger.js';

const COMPONENT = 'output-parser';

// Bob Shell event types (based on actual output)
export type BobShellEvent =
  | InitEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent;

export interface InitEvent {
  type: 'init';
  timestamp: string;
  session_id: string;
  model: string;
}

export interface MessageEvent {
  type: 'message';
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
  delta?: boolean;
}

export interface ToolUseEvent {
  type: 'tool_use';
  timestamp: string;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  timestamp: string;
  tool_id: string;
  status: 'success' | 'error';
  output: string;
}

export interface ResultEvent {
  type: 'result';
  timestamp: string;
  status: 'success' | 'error';
  stats: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
    session_costs: number;
    max_budget: number;
    budget_spend: number;
    tool_calls: number;
  };
}

export class OutputParser {
  /**
   * Parse a line of Bob Shell stream-json output
   */
  parseLine(line: string, sessionId: string): BobShellEvent | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    // Log raw JSON from Bob Shell
    logger.debug(COMPONENT, 'Raw JSON from Bob Shell', {
      sessionId,
      rawJson: trimmed
    }, sessionId);

    try {
      const event = JSON.parse(trimmed);
      
      // Validate event has a type
      if (!event || typeof event.type !== 'string') {
        logger.warn(COMPONENT, 'Event missing type field', {
          sessionId,
          event
        }, sessionId);
        return null;
      }

      logger.debug(COMPONENT, 'Parsed Bob Shell event', {
        sessionId,
        type: event.type,
        event: event
      }, sessionId);

      return event as BobShellEvent;
    } catch (error) {
      logger.error(COMPONENT, 'Failed to parse line', {
        sessionId,
        error: String(error),
        line: trimmed.substring(0, 100) // Log first 100 chars
      }, sessionId);
      return null;
    }
  }

  /**
   * Check if an event signals completion
   */
  isDoneEvent(event: BobShellEvent): boolean {
    return event.type === 'result';
  }

  /**
   * Check if an event is an error
   */
  isErrorEvent(event: BobShellEvent): boolean {
    return event.type === 'result' && event.status === 'error';
  }
}

export const outputParser = new OutputParser();

// Made with Bob
