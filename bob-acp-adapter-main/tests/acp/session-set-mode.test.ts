import { describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/session/session-manager.js';
import { handleSessionSetMode } from '../../src/acp/methods/session-set-mode.js';
import { JsonRpcRequest } from '../../src/acp/types.js';
import { InvalidParamsError, SessionNotFoundError } from '../../src/utils/errors.js';

describe('session/set_mode', () => {
  it('throws_session_not_found_error_for_unknown_session', async () => {
    const sessionManager = new SessionManager();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/set_mode',
      params: {
        sessionId: 'missing-session',
        modeId: 'code',
      },
    };

    await expect(handleSessionSetMode(request, sessionManager)).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('throws_invalid_params_for_unknown_mode', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession(process.cwd(), 'code');
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/set_mode',
      params: {
        sessionId: session.id,
        modeId: 'invalid-mode',
      },
    };

    await expect(handleSessionSetMode(request, sessionManager)).rejects.toBeInstanceOf(InvalidParamsError);
  });

  it('updates_mode_for_valid_mode', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession(process.cwd(), 'code');
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/set_mode',
      params: {
        sessionId: session.id,
        modeId: 'plan',
      },
    };

    const response = await handleSessionSetMode(request, sessionManager);
    const updatedSession = sessionManager.getSession(session.id);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
    expect(updatedSession?.mode).toBe('plan');
  });
});
