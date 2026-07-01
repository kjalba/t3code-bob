import { describe, expect, it, vi } from 'vitest';
import { JsonRpcErrorCode } from '../../src/acp/types.js';
import { StdioTransport } from '../../src/transport/stdio-transport.js';

describe('StdioTransport line handling', () => {
  it('emits_parse_error_response_for_malformed_json', () => {
    const transport = new StdioTransport();
    const sendResponseSpy = vi.spyOn(transport, 'sendResponse').mockImplementation(() => undefined);

    (transport as any).handleLine('{not-valid-json', vi.fn());

    expect(sendResponseSpy).toHaveBeenCalledTimes(1);
    expect(sendResponseSpy).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: JsonRpcErrorCode.ParseError,
        message: 'Invalid JSON payload',
      },
    });
  });

  it('passes_valid_request_to_message_handler', () => {
    const transport = new StdioTransport();
    const onMessage = vi.fn();

    (transport as any).handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      }),
      onMessage
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({
      method: 'initialize',
      id: 1,
    });
  });

  it('ignores_non_json_noise_lines_without_parse_response', () => {
    const transport = new StdioTransport();
    const sendResponseSpy = vi.spyOn(transport, 'sendResponse').mockImplementation(() => undefined);

    (transport as any).handleLine('Content-Length: 123', vi.fn());

    expect(sendResponseSpy).not.toHaveBeenCalled();
  });
});
