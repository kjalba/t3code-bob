/**
 * Path validation and sanitization for security
 */

import { resolve, isAbsolute, normalize } from 'path';
import { SecurityViolationError } from '../utils/errors.js';
import { logger } from '../transport/logger.js';

const COMPONENT = 'path-validator';

export class PathValidator {
  /**
   * Validate that a path is absolute and safe
   */
  validateCwd(cwd: string): string {
    // Must be absolute
    if (!isAbsolute(cwd)) {
      logger.warn(COMPONENT, 'Rejected relative cwd path', { cwd });
      throw new SecurityViolationError('cwd must be an absolute path', { cwd });
    }

    // Normalize to remove any .. or . segments
    const normalized = normalize(cwd);

    // Check for suspicious patterns
    if (this.hasSuspiciousPatterns(normalized)) {
      logger.warn(COMPONENT, 'Rejected cwd with suspicious patterns', { cwd: normalized });
      throw new SecurityViolationError('cwd contains suspicious patterns', { cwd: normalized });
    }

    logger.debug(COMPONENT, 'Validated cwd', { cwd: normalized });
    return normalized;
  }

  /**
   * Validate that a file path is within the allowed cwd
   */
  validateFilePath(filePath: string, cwd: string): string {
    const normalized = normalize(filePath);
    const absolute = isAbsolute(normalized) ? normalized : resolve(cwd, normalized);

    // Check if the resolved path is within cwd
    if (!this.isWithinDirectory(absolute, cwd)) {
      logger.warn(COMPONENT, 'Rejected file path outside cwd', { 
        filePath: absolute, 
        cwd 
      });
      throw new SecurityViolationError('File path is outside allowed directory', { 
        filePath: absolute, 
        cwd 
      });
    }

    logger.debug(COMPONENT, 'Validated file path', { filePath: absolute, cwd });
    return absolute;
  }

  /**
   * Check if a path is within a directory
   */
  private isWithinDirectory(path: string, directory: string): boolean {
    const normalizedPath = normalize(path);
    const normalizedDir = normalize(directory);

    // Ensure directory ends with separator for proper prefix check
    const dirWithSep = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
    
    return normalizedPath === normalizedDir || normalizedPath.startsWith(dirWithSep);
  }

  /**
   * Check for suspicious patterns in paths
   */
  private hasSuspiciousPatterns(path: string): boolean {
    const suspicious = [
      /\.\./,           // Parent directory traversal
      /~\//,            // Home directory expansion
      /\$\{/,           // Variable expansion
      /\$\(/,           // Command substitution
      /`/,              // Backticks
      /\|/,             // Pipes
      /;/,              // Command chaining
      /&/,              // Background execution
      />/,              // Redirection
      /</,              // Redirection
    ];

    return suspicious.some(pattern => pattern.test(path));
  }

  /**
   * Sanitize environment variables
   */
  sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const allowlist = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TERM',
      'BOB_PATH',
      'BOB_LOG_LEVEL',
      'BOB_TIMEOUT',
      'BOB_MAX_OUTPUT_SIZE',
      'BOB_DEFAULT_MODE',
      'NODE_ENV',
    ];

    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (allowlist.includes(key)) {
        sanitized[key] = value;
      } else {
        logger.debug(COMPONENT, 'Filtered out environment variable', { key });
      }
    }

    return sanitized;
  }
}

export const pathValidator = new PathValidator();

// Made with Bob
