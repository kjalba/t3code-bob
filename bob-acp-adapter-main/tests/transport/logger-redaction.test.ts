import { describe, expect, it } from 'vitest';
import { redactSensitiveData } from '../../src/transport/logger.js';

describe('logger redaction', () => {
  it('redacts_token_like_fields_recursively', () => {
    const data = {
      token: 'abc',
      nested: {
        authorization: 'Bearer x',
        deeper: {
          apiKey: 'secret',
        },
      },
      items: [
        { password: 'pw' },
        { value: 'ok' },
      ],
    };

    const redacted = redactSensitiveData(data) as any;
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.nested.authorization).toBe('[REDACTED]');
    expect(redacted.nested.deeper.apiKey).toBe('[REDACTED]');
    expect(redacted.items[0].password).toBe('[REDACTED]');
  });

  it('keeps_non_sensitive_fields_unmodified', () => {
    const data = {
      method: 'session/prompt',
      params: {
        sessionId: 'sess_1',
        prompt: 'hello',
      },
    };

    const redacted = redactSensitiveData(data);
    expect(redacted).toEqual(data);
  });
});
