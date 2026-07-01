import { describe, expect, it } from 'vitest';
import { handleInitialize } from '../../src/acp/methods/initialize.js';
import { JsonRpcRequest } from '../../src/acp/types.js';

describe('initialize', () => {
  it('returns_capabilities_that_match_documented_behavior', () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    const response = handleInitialize(request);
    expect(response.result).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        mcpCapabilities: {
          http: false,
          sse: false,
        },
      },
      agentInfo: {
        name: 'Bob Shell ACP Adapter',
        version: '0.1.1',
      },
    });
  });
});
