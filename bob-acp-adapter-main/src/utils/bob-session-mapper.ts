/**
 * Bob Session Mapper - Maps IntelliJ ACP session IDs to Bob Shell session indices
 * 
 * Bob Shell uses session identifiers (UUIDs) for resumption.
 * IntelliJ uses UUID-based session IDs (sess_507ec3dc-624f-4537-9c7a-2320c490b7ab).
 * 
 * This utility maintains a mapping file (.bob/bob-acp-sessions.json) to translate
 * ACP session IDs to Bob session IDs.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../transport/logger.js';

const COMPONENT = 'bob-session-mapper';
const MAPPING_FILE = 'bob-acp-sessions.json';

export interface SessionMapping {
  acpSessionId: string;
  bobSessionId: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface SessionMappingFile {
  version: string;
  mappings: SessionMapping[];
}

export class BobSessionMapper {
  /**
   * Get the path to the mapping file for a given directory
   */
  private getMappingFilePath(cwd: string): string {
    return path.join(cwd, '.bob', MAPPING_FILE);
  }

  /**
   * Ensure .bob directory exists
   */
  private async ensureBobDirectory(cwd: string): Promise<void> {
    const bobDir = path.join(cwd, '.bob');
    try {
      await fs.mkdir(bobDir, { recursive: true });
    } catch (error) {
      logger.error(COMPONENT, 'Failed to create .bob directory', {
        cwd,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Read the mapping file
   */
  private async readMappingFile(cwd: string): Promise<SessionMappingFile> {
    const filePath = this.getMappingFilePath(cwd);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Handle empty or corrupted file
      if (!content || content.trim() === '') {
        logger.warn(COMPONENT, 'Mapping file is empty, creating new', { cwd });
        return {
          version: '1.0',
          mappings: [],
        };
      }
      
      const rawData = JSON.parse(content) as SessionMappingFile & {
        mappings?: Array<SessionMapping & { bobSessionIndex?: number }>;
      };
      const data: SessionMappingFile = {
        version: rawData.version || '1.0',
        mappings: (rawData.mappings || [])
          .map((mapping) => {
            const candidate = mapping as SessionMapping & { bobSessionIndex?: number };
            const legacyIndex = candidate.bobSessionIndex;
            const bobSessionId = candidate.bobSessionId ?? (legacyIndex !== undefined ? String(legacyIndex) : '');
            if (!bobSessionId) {
              return null;
            }
            return {
              acpSessionId: candidate.acpSessionId,
              bobSessionId,
              createdAt: candidate.createdAt,
              lastUsedAt: candidate.lastUsedAt,
            };
          })
          .filter((mapping): mapping is SessionMapping => mapping !== null),
      };
      
      logger.debug(COMPONENT, 'Read mapping file', {
        cwd,
        mappingCount: data.mappings.length,
      });
      
      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty mappings
        logger.debug(COMPONENT, 'Mapping file does not exist, creating new', { cwd });
        return {
          version: '1.0',
          mappings: [],
        };
      }
      
      // Handle JSON parse errors (corrupted file)
      if (error instanceof SyntaxError) {
        logger.warn(COMPONENT, 'Mapping file is corrupted, creating new', {
          cwd,
          error: String(error),
        });
        return {
          version: '1.0',
          mappings: [],
        };
      }
      
      logger.error(COMPONENT, 'Failed to read mapping file', {
        cwd,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Write the mapping file
   */
  private async writeMappingFile(cwd: string, data: SessionMappingFile): Promise<void> {
    await this.ensureBobDirectory(cwd);
    const filePath = this.getMappingFilePath(cwd);
    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    
    try {
      const content = JSON.stringify(data, null, 2);
      await fs.writeFile(tempFilePath, content, 'utf-8');
      await fs.rename(tempFilePath, filePath);
      
      logger.debug(COMPONENT, 'Wrote mapping file', {
        cwd,
        mappingCount: data.mappings.length,
      });
    } catch (error) {
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors; temp file may not exist.
      }

      logger.error(COMPONENT, 'Failed to write mapping file', {
        cwd,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Get the Bob Shell session index for an ACP session ID
   * Returns null if no mapping exists
   */
  async getBobSessionId(cwd: string, acpSessionId: string): Promise<string | null> {
    const data = await this.readMappingFile(cwd);
    const mapping = data.mappings.find(m => m.acpSessionId === acpSessionId);
    
    if (mapping) {
      logger.debug(COMPONENT, 'Found existing session mapping', {
        cwd,
        acpSessionId,
        bobSessionId: mapping.bobSessionId,
      });
      
      // Update last used timestamp
      mapping.lastUsedAt = new Date().toISOString();
      await this.writeMappingFile(cwd, data);
      
      return mapping.bobSessionId;
    }
    
    logger.debug(COMPONENT, 'No existing session mapping found', {
      cwd,
      acpSessionId,
    });
    
    return null;
  }

  /**
   * Create or update a session mapping.
   */
  async createSessionMapping(
    cwd: string,
    acpSessionId: string,
    bobSessionId: string
  ): Promise<void> {
    const data = await this.readMappingFile(cwd);
    
    // Check if mapping already exists
    const existingIndex = data.mappings.findIndex(m => m.acpSessionId === acpSessionId);
    if (existingIndex !== -1) {
      logger.warn(COMPONENT, 'Session mapping already exists, updating', {
        cwd,
        acpSessionId,
        oldBobSessionId: data.mappings[existingIndex].bobSessionId,
        newBobSessionId: bobSessionId,
      });
      data.mappings[existingIndex].bobSessionId = bobSessionId;
      data.mappings[existingIndex].lastUsedAt = new Date().toISOString();
    } else {
      // Create new mapping
      const now = new Date().toISOString();
      const mapping: SessionMapping = {
        acpSessionId,
        bobSessionId,
        createdAt: now,
        lastUsedAt: now,
      };
      
      data.mappings.push(mapping);
      
      logger.info(COMPONENT, 'Created new session mapping', {
        cwd,
        acpSessionId,
        bobSessionId,
      });
    }
    
    await this.writeMappingFile(cwd, data);
  }

  /**
   * Delete a session mapping
   */
  async deleteSessionMapping(cwd: string, acpSessionId: string): Promise<boolean> {
    const data = await this.readMappingFile(cwd);
    const initialLength = data.mappings.length;
    
    data.mappings = data.mappings.filter(m => m.acpSessionId !== acpSessionId);
    
    if (data.mappings.length < initialLength) {
      await this.writeMappingFile(cwd, data);
      
      logger.info(COMPONENT, 'Deleted session mapping', {
        cwd,
        acpSessionId,
      });
      
      return true;
    }
    
    logger.debug(COMPONENT, 'No session mapping to delete', {
      cwd,
      acpSessionId,
    });
    
    return false;
  }

  /**
   * Get all session mappings for a directory
   */
  async getAllMappings(cwd: string): Promise<SessionMapping[]> {
    const data = await this.readMappingFile(cwd);
    return data.mappings;
  }

  /**
   * Clean up old session mappings (optional, for maintenance)
   */
  async cleanupOldMappings(cwd: string, maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const data = await this.readMappingFile(cwd);
    const now = Date.now();
    const initialLength = data.mappings.length;
    
    data.mappings = data.mappings.filter(mapping => {
      const lastUsed = new Date(mapping.lastUsedAt).getTime();
      const age = now - lastUsed;
      return age <= maxAgeMs;
    });
    
    const cleaned = initialLength - data.mappings.length;
    
    if (cleaned > 0) {
      await this.writeMappingFile(cwd, data);
      
      logger.info(COMPONENT, 'Cleaned up old session mappings', {
        cwd,
        cleaned,
        remaining: data.mappings.length,
      });
    }
    
    return cleaned;
  }
}

export const bobSessionMapper = new BobSessionMapper();

// Made with Bob
