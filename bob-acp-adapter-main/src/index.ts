#!/usr/bin/env node

/**
 * Bob Shell ACP Adapter
 * Entry point for the ACP adapter that bridges IntelliJ IDEA with Bob Shell
 */

import { StdioTransport } from './transport/stdio-transport.js';
import { ProtocolHandler } from './acp/protocol-handler.js';
import { logger } from './transport/logger.js';

const COMPONENT = 'main';
const VERSION = '0.2.0';

// Global references for cleanup
let transport: StdioTransport | null = null;
let protocolHandler: ProtocolHandler | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.debug(COMPONENT, 'Shutdown already in progress', { signal });
    return;
  }
  
  isShuttingDown = true;
  logger.info(COMPONENT, `Received ${signal}, shutting down gracefully`);

  try {
    // Clean up all active sessions with timeout
    if (protocolHandler) {
      await Promise.race([
        protocolHandler.cleanup(),
        new Promise((resolve) => setTimeout(() => {
          logger.warn(COMPONENT, 'Cleanup timeout exceeded, forcing shutdown');
          resolve(undefined);
        }, 5000))
      ]);
    }

    // Stop transport
    if (transport) {
      transport.stop();
    }

    logger.info(COMPONENT, 'Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error(COMPONENT, 'Error during shutdown', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

async function main() {
  // Log all startup parameters and environment
  logger.info(COMPONENT, 'Starting Bob Shell ACP Adapter', {
    version: VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    execPath: process.execPath,
    argv: process.argv,
    env: {
      BOB_LOG_LEVEL: process.env.BOB_LOG_LEVEL,
      BOB_LOG_FILE: process.env.BOB_LOG_FILE,
      HOME: process.env.HOME,
      USER: process.env.USER,
      PATH: process.env.PATH?.substring(0, 200) + '...',
    },
  });

  // Create transport and protocol handler
  transport = new StdioTransport();
  protocolHandler = new ProtocolHandler(transport);

  // Handle incoming messages
  transport.start((request) => {
    protocolHandler!.handleRequest(request).catch((error) => {
      logger.error(COMPONENT, 'Unhandled error in request handler', {
        error: String(error),
      });
    });
  });

  // Handle process signals for graceful shutdown
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error(COMPONENT, 'Uncaught exception', {
      error: String(error),
      stack: error.stack,
    });
    shutdown('uncaughtException').then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(COMPONENT, 'Unhandled rejection', {
      reason: String(reason),
    });
    shutdown('unhandledRejection').then(() => process.exit(1));
  });

  logger.info(COMPONENT, 'Bob Shell ACP Adapter ready');
}

// Start the adapter
main().catch((error) => {
  logger.error(COMPONENT, 'Fatal error during startup', {
    error: String(error),
  });
  process.exit(1);
});

// Made with Bob
