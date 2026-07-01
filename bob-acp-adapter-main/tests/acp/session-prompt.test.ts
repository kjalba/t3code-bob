import { describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../../src/session/session-manager.js';
import { handleSessionPrompt } from '../../src/acp/methods/session-prompt.js';
import { JsonRpcRequest } from '../../src/acp/types.js';
import { SessionBusyError } from '../../src/utils/errors.js';

describe('session/prompt', () => {
  it('rejects_prompt_when_process_is_already_running', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession(process.cwd(), 'code');
    sessionManager.setRunningProcess(session.id, { pid: 42 } as any);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/prompt',
      params: {
        sessionId: session.id,
        prompt: 'hello',
      },
    };

    const bobShellBridge = {
      executePrompt: async () => {
        throw new Error('should not be called');
      },
    } as any;
    const transport = {
      sendNotification: () => undefined,
    } as any;

    await expect(handleSessionPrompt(request, sessionManager, bobShellBridge, transport)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it('parses_array_prompt_blocks_as_plain_text', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession(process.cwd(), 'code');

    const executePrompt = vi.fn(async (options: any) => {
      options.onComplete();
      return { pid: 99 };
    });
    const bobShellBridge = {
      executePrompt,
    } as any;
    const transport = {
      sendNotification: () => undefined,
    } as any;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: {
        sessionId: session.id,
        prompt: [{ type: 'text', text: 'Testing, bob are you there?' }],
      },
    };

    const response = await handleSessionPrompt(request, sessionManager, bobShellBridge, transport);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { stopReason: 'end_turn' },
    });
    expect(executePrompt).toHaveBeenCalledTimes(1);
    expect(executePrompt.mock.calls[0][0].prompt).toBe('Testing, bob are you there?');
  });
});
