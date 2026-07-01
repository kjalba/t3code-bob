/**
 * Bob Shell bridge - orchestrates Bob Shell process execution and event streaming
 */

import { createInterface } from 'readline';
import { ProcessManager } from './process-manager.js';
import { outputParser } from './output-parser.js';
import { eventMapper } from './event-mapper.js';
import { logger } from '../transport/logger.js';
import {SessionNotification} from "@agentclientprotocol/sdk";

const COMPONENT = 'bob-shell-bridge';

export interface BobShellBridgeOptions {
  sessionId: string;
  cwd: string;
  mode: string;
  prompt: string;
  bobSessionId?: string | null;
  onInit?: (bobSessionId: string) => void;
  onUpdate: (update: SessionNotification) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  sessionManager?: any; // SessionManager instance for turn counter management
}

export class BobShellBridge {
  private processManager: ProcessManager;

  constructor() {
    this.processManager = new ProcessManager();
  }

  /**
   * Execute a prompt with Bob Shell and stream updates
   */
  executePrompt(options: BobShellBridgeOptions): Promise<any> {
    const { sessionId, cwd, mode, prompt, bobSessionId, onInit, onUpdate, onComplete, onError, sessionManager } = options;

    // Increment turn counter for this new prompt
    if (sessionManager) {
      sessionManager.incrementTurnCounter(sessionId);
      // Set session manager on event mapper for unique tool ID generation
      eventMapper.setSessionManager(sessionManager);
    }

    logger.info(COMPONENT, 'Executing prompt', {
      sessionId,
      cwd,
      mode,
      promptLength: prompt.length,
      bobSessionId: bobSessionId ?? 'new',
      turnCounter: sessionManager ? sessionManager.getTurnCounter(sessionId) : 0,
    }, sessionId);

    return new Promise((resolve, reject) => {
      try {
        let completed = false;
        let failed = false;
        const completeOnce = () => {
          if (completed) {
            return;
          }
          completed = true;
          // Reset thinking state once at completion
          eventMapper.resetThinkingState();
          onComplete();
        };

        // Spawn Bob Shell process
        const child = this.processManager.spawnBobShell({
          cwd,
          mode,
          prompt,
          sessionId,
          bobSessionId,
        });

        // Resolve with the child process immediately for cancellation support
        resolve(child);

        // Handle process errors
        child.on('error', (error: any) => {
          failed = true;
          logger.error(COMPONENT, 'Process error', {
            sessionId,
            error: String(error),
          }, sessionId);
          onError(error);
        });

        // Handle unexpected exit
        child.on('exit', (code: any, signal: any) => {
          if (code !== 0 && code !== null) {
            failed = true;
            logger.error(COMPONENT, 'Process exited with non-zero code', {
              sessionId,
              code,
              signal,
            }, sessionId);
            onError(new Error(`Bob Shell exited with code ${code}`));
          }
        });

        // Parse stdout line by line
        if (child.stdout) {
          const readline = createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
          });

          readline.on('line', (line: any) => {
            // Parse the event
            const event = outputParser.parseLine(line, sessionId);
            if (!event) {
              return;
            }

            // Check for completion
            if (outputParser.isDoneEvent(event)) {
              logger.info(COMPONENT, 'Received done event', { sessionId }, sessionId);
              completeOnce();
              return;
            }

            if (event.type === 'init' && onInit && event.session_id) {
              onInit(event.session_id);
            }

            // Map to ACP update - may return multiple updates for thinking tags
            const update = eventMapper.mapEvent(event, sessionId);
            if (update) {
                const updates = Array.isArray(update) ? update : [update];
                updates.forEach(value => onUpdate({sessionId, update: value}))
            }
          });

          readline.on('close', () => {
            logger.debug(COMPONENT, 'Stdout closed', { sessionId }, sessionId);
            if (failed) {
              return;
            }
            if (!completed) {
              onError(new Error('Bob Shell stream closed before completion'));
              return;
            }
            completeOnce();
          });
        }
      } catch (error) {
        logger.error(COMPONENT, 'Failed to execute prompt', {
          sessionId,
          error: String(error),
        }, sessionId);
        onError(error as Error);
        reject(error);
      }
    });
  }
}

// Made with Bob
