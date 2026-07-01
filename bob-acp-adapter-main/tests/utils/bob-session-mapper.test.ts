import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BobSessionMapper } from '../../src/utils/bob-session-mapper.js';

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bob-session-mapper-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('BobSessionMapper', () => {
  it('recovers_from_empty_mapping_file', async () => {
    const cwd = await createTempProject();
    await mkdir(join(cwd, '.bob'), { recursive: true });
    await writeFile(join(cwd, '.bob', 'bob-acp-sessions.json'), '', 'utf-8');

    const mapper = new BobSessionMapper();
    const result = await mapper.getBobSessionId(cwd, 'sess_1');

    expect(result).toBeNull();
  });

  it('writes_mapping_file_atomically', async () => {
    const cwd = await createTempProject();
    const mapper = new BobSessionMapper();

    await mapper.createSessionMapping(cwd, 'sess_1', 'bob-session-1');

    const fileContent = await readFile(join(cwd, '.bob', 'bob-acp-sessions.json'), 'utf-8');
    expect(() => JSON.parse(fileContent)).not.toThrow();
    const bobDirFiles = await readdir(join(cwd, '.bob'));
    const tempFiles = bobDirFiles.filter((file) => file.includes('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  it('handles_consecutive_create_mapping_calls_without_data_loss', async () => {
    const cwd = await createTempProject();
    const mapper = new BobSessionMapper();

    await mapper.createSessionMapping(cwd, 'sess_1', 'bob-session-1');
    await mapper.createSessionMapping(cwd, 'sess_2', 'bob-session-2');

    const mappings = await mapper.getAllMappings(cwd);
    const sessionIds = mappings.map((mapping) => mapping.acpSessionId).sort();
    expect(sessionIds).toEqual(['sess_1', 'sess_2']);

    const bobDirFiles = await readdir(join(cwd, '.bob'));
    const tempFiles = bobDirFiles.filter((file) => file.includes('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });
});
