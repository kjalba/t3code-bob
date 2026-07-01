/**
 * Process manager for spawning and managing Bob Shell processes
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../transport/logger.js';
import { pathValidator } from '../security/path-validator.js';

const COMPONENT = 'process-manager';

export interface BobShellOptions {
  cwd: string;
  mode: string;
  prompt: string;
  sessionId: string;
  timeout?: number;
  bobSessionId?: string | null; // Bob Shell session identifier for resumption
}

export class ProcessManager {
  private readonly bobPath: string;
  private readonly defaultTimeout: number;

  constructor() {
    this.bobPath = process.env.BOB_PATH || 'bob';
    this.defaultTimeout = parseInt(process.env.BOB_TIMEOUT || '300', 10) * 1000; // Convert to ms
  }

  /**
   * Spawn a Bob Shell process
   */
  spawnBobShell(options: BobShellOptions): ChildProcess {
    const { cwd, mode, prompt, sessionId, timeout = this.defaultTimeout, bobSessionId } = options;

    // Build command arguments
    const args: string[] = [];
    const isResuming = bobSessionId !== null && bobSessionId !== undefined;

    // Add --resume flag if we have a Bob session index
    if (isResuming) {
      args.push('--resume', String(bobSessionId));
      // Use --prompt flag for resuming (deprecated but currently required)
      args.push('--prompt', prompt);
      logger.info(COMPONENT, 'Resuming Bob Shell session', {
        sessionId,
        bobSessionId,
      }, sessionId);
    } else {
      // For new sessions, use positional argument
      args.push(prompt);
    }
    
    // Add other flags
    args.push('--output-format', 'stream-json');
    args.push('--chat-mode', mode);
    args.push('--approval-mode', 'yolo');

    logger.info(COMPONENT, 'Spawning Bob Shell process', {
      sessionId,
      cwd,
      mode,
      promptLength: prompt.length,
      bobSessionId: bobSessionId ?? 'new',
      isResuming,
    }, sessionId);

    // Sanitize environment
    const env = pathValidator.sanitizeEnv({
      ...process.env,
      BOB_PATH: this.bobPath,
    } as Record<string, string>);

    // Spawn process
    const child = spawn(this.bobPath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored, stdout/stderr piped
    });

    logger.debug(COMPONENT, 'Process spawned', {
      sessionId,
      pid: child.pid,
    }, sessionId);

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      logger.warn(COMPONENT, 'Process timeout, killing', {
        sessionId,
        pid: child.pid,
        timeout,
      }, sessionId);
      child.kill('SIGTERM');
    }, timeout);

    // Clear timeout when process exits
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      logger.info(COMPONENT, 'Process exited', {
        sessionId,
        pid: child.pid,
        code,
        signal,
      }, sessionId);
    });

    // Log stderr (Bob Shell logs)
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.debug(COMPONENT, 'Bob Shell stderr', {
          sessionId,
          text,
        }, sessionId);
      }
    });

    return child;
  }

  /**
   * Kill a process gracefully
   */
  killProcess(child: ChildProcess, sessionId: string): void {
    if (!child.pid) {
      logger.warn(COMPONENT, 'Cannot kill process without PID', { sessionId }, sessionId);
      return;
    }

    const pid = child.pid;
    logger.info(COMPONENT, 'Killing process', {
      sessionId,
      pid,
    }, sessionId);

    try {
      // Track if process has exited
      let hasExited = false;
      child.once('exit', () => {
        hasExited = true;
      });

      // Try SIGTERM first
      child.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!hasExited && pid) {
          logger.warn(COMPONENT, 'Process did not terminate, sending SIGKILL', {
            sessionId,
            pid,
          }, sessionId);
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            // Process may have already exited
            logger.debug(COMPONENT, 'SIGKILL failed, process may have exited', {
              sessionId,
              pid,
              error: String(error),
            }, sessionId);
          }
        }
      }, 5000);
    } catch (error) {
      logger.error(COMPONENT, 'Failed to kill process', {
        sessionId,
        error: String(error),
      }, sessionId);
    }
  }
}

// Made with Bob
