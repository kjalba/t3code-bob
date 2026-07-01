/**
 * Handle ACP session/prompt method
 */

import {
  SessionPromptParams,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../types.js';
import { SessionManager } from '../../session/session-manager.js';
import { BobShellBridge } from '../../bridge/bob-shell-bridge.js';
import { StdioTransport } from '../../transport/stdio-transport.js';
import { logger } from '../../transport/logger.js';
import { SessionNotFoundError, InvalidParamsError, SessionBusyError } from '../../utils/errors.js';
import { writeMcpConfig } from '../../utils/mcp-config-writer.js';
import { bobSessionMapper } from '../../utils/bob-session-mapper.js';
import {SessionNotification} from "@agentclientprotocol/sdk";
import { limitOutputSize } from '../../utils/output-limiter.js';

const COMPONENT = 'session-prompt-handler';

export async function handleSessionPrompt(
  request: JsonRpcRequest,
  sessionManager: SessionManager,
  bobShellBridge: BobShellBridge,
  transport: StdioTransport
): Promise<JsonRpcResponse> {
  const params = request.params as SessionPromptParams;

  // Log the full params for debugging
  logger.info(COMPONENT, 'Received session/prompt params', {
    sessionId: params?.sessionId,
    promptType: typeof params?.prompt,
    hasContent: params?.prompt && typeof params.prompt === 'object' ? 'content' in params.prompt : false,
    fullParams: params,
  });

  // Validate required parameters
  if (!params || !params.sessionId || !params.prompt) {
    throw new InvalidParamsError('Missing required parameters: sessionId and prompt');
  }

  const session = sessionManager.getSession(params.sessionId);
  if (!session) {
    throw new SessionNotFoundError(params.sessionId);
  }
  if (session.runningProcess) {
    throw new SessionBusyError(params.sessionId);
  }

  // Extract text from prompt (handle both string and object formats)
  let promptText: string;
  if (typeof params.prompt === 'string') {
    promptText = params.prompt;
  } else if (Array.isArray(params.prompt)) {
    promptText = params.prompt
      .filter((block: any) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n');
  } else if (params.prompt && typeof params.prompt === 'object' && 'content' in params.prompt) {
    promptText = params.prompt.content.map(block => block.text).join('\n');
  } else {
    // Fallback: try to stringify the object
    logger.warn(COMPONENT, 'Unexpected prompt format, stringifying', {
      sessionId: params.sessionId,
      prompt: JSON.stringify(params.prompt),
    }, params.sessionId);
    promptText = JSON.stringify(params.prompt);
  }

  logger.info(COMPONENT, 'Processing prompt', {
    sessionId: params.sessionId,
    promptLength: promptText.length,
    promptType: typeof params.prompt,
    promptText: promptText,
    promptPreview: promptText.substring(0, 200) + (promptText.length > 200 ? '...' : ''),
  }, params.sessionId);

  // Add user message to history
  sessionManager.addMessage(params.sessionId, 'user', promptText);

  // Ensure MCP config is written before executing Bob Shell
  // This handles race conditions where session/prompt arrives before session/new completes
  if (session.mcpServers && session.mcpServers.length > 0) {
    try {
      await writeMcpConfig(session.cwd, session.mcpServers, params.sessionId);
      logger.debug(COMPONENT, 'MCP config ensured before Bob Shell execution', {
        sessionId: params.sessionId,
        serverCount: session.mcpServers.length,
      }, params.sessionId);
    } catch (error) {
      logger.warn(COMPONENT, 'Failed to ensure MCP config, continuing anyway', {
        sessionId: params.sessionId,
        error: String(error),
      }, params.sessionId);
    }
  }

  // Determine Bob session identifier for resumption.
  let bobSessionId: string | null = session.bobSessionId;
  if (!bobSessionId) {
    const existingId = await bobSessionMapper.getBobSessionId(session.cwd, params.sessionId);
    if (existingId !== null && !/^\d+$/.test(existingId)) {
      bobSessionId = existingId;
      sessionManager.setBobSessionId(params.sessionId, existingId);
      logger.info(COMPONENT, 'Resuming existing Bob Shell session', {
        sessionId: params.sessionId,
        bobSessionId,
      }, params.sessionId);
    } else if (existingId !== null) {
      logger.warn(COMPONENT, 'Ignoring legacy numeric Bob session identifier', {
        sessionId: params.sessionId,
        legacyId: existingId,
      }, params.sessionId);
    }
  } else {
    logger.debug(COMPONENT, 'Using existing Bob Shell session', {
      sessionId: params.sessionId,
      bobSessionId,
    }, params.sessionId);
  }

  // Execute prompt with Bob Shell
  // MCP servers are already started by session manager during session creation
  return new Promise((resolve, reject) => {
    let assistantMessage = '';

    bobShellBridge.executePrompt({
      sessionId: params.sessionId,
      cwd: session.cwd,
      mode: session.mode,
      prompt: promptText,
      bobSessionId,
      sessionManager: sessionManager,  // Pass session manager for turn counter
      onInit: (newBobSessionId: string) => {
        sessionManager.setBobSessionId(params.sessionId, newBobSessionId);
        bobSessionMapper.createSessionMapping(session.cwd, params.sessionId, newBobSessionId).catch((error) => {
          logger.warn(COMPONENT, 'Failed to persist Bob session mapping', {
            sessionId: params.sessionId,
            bobSessionId: newBobSessionId,
            error: String(error),
          }, params.sessionId);
        });
      },

      onUpdate: (update: SessionNotification) => {
        const limited = limitOutputSize(update);
        const notificationParams: Record<string, unknown> = limited.payload as Record<string, unknown>;
        if (limited.truncated) {
          notificationParams._meta = {
            ...(notificationParams._meta as Record<string, unknown> | undefined),
            truncated: true,
          };
        }

        // Send session/update notification to client
        transport.sendNotification({
          jsonrpc: '2.0',
          method: 'session/update',
          params: notificationParams,
        });

        // Accumulate agent messages for history (including final results from attempt_completion)
        if (limited.payload.update.sessionUpdate === 'agent_message_chunk' && limited.payload.update.content.type === 'text') {
          assistantMessage += limited.payload.update.content.text;
        }
      },

      onComplete: () => {
        logger.info(COMPONENT, 'Prompt completed', {
          sessionId: params.sessionId,
        }, params.sessionId);

        // Add assistant message to history
        if (assistantMessage) {
          sessionManager.addMessage(params.sessionId, 'assistant', assistantMessage);
        }

        // Clear running process
        sessionManager.clearRunningProcess(params.sessionId);

        // Send final response with required stopReason field
        resolve({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            stopReason: 'end_turn',
          },
        });
      },

      onError: (error: Error) => {
        logger.error(COMPONENT, 'Prompt execution failed', {
          sessionId: params.sessionId,
          error: String(error),
        }, params.sessionId);

        // Send error update to client
        transport.sendNotification({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            update: {
              type: 'error',
              message: error.message,
            },
          },
        });

        // Clear running process
        sessionManager.clearRunningProcess(params.sessionId);

        // Reject the promise
        reject(error);
      },
    }).then((child: any) => {
      // Store the running process for cancellation support
      if (child) {
        sessionManager.setRunningProcess(params.sessionId, child);
      }
    }).catch((error: Error) => {
      reject(error);
    });
  });
}

// Made with Bob
