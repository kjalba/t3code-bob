import { describe, expect, it, vi } from 'vitest';
import { ProtocolHandler } from '../../src/acp/protocol-handler.js';
import { JsonRpcRequest } from '../../src/acp/types.js';

function createTransportStub() {
  return {
    sendResponse: vi.fn(),
    sendNotification: vi.fn(),
  };
}

describe('ProtocolHandler notification behavior', () => {
  it('does_not_send_response_for_notifications_without_id', async () => {
    const transport = createTransportStub();
    const handler = new ProtocolHandler(transport as any);
    const notification = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    } as unknown as JsonRpcRequest;

    await handler.handleRequest(notification);

    expect(transport.sendResponse).not.toHaveBeenCalled();
  });

  it('sends_response_for_requests_with_id', async () => {
    const transport = createTransportStub();
    const handler = new ProtocolHandler(transport as any);
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

    await handler.handleRequest(request);

    expect(transport.sendResponse).toHaveBeenCalledTimes(1);
  });
});
