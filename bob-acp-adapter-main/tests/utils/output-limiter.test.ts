import { describe, expect, it } from 'vitest';
import { limitOutputSize } from '../../src/utils/output-limiter.js';

describe('output limiter', () => {
  it('does_not_modify_small_text_payloads', () => {
    const payload = {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'small' },
      },
    };

    const result = limitOutputSize(payload, 64);
    expect(result.truncated).toBe(false);
    expect(result.payload).toEqual(payload);
  });

  it('truncates_large_text_payloads_with_suffix', () => {
    const payload = {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'x'.repeat(200) },
      },
    };

    const result = limitOutputSize(payload, 64);
    expect(result.truncated).toBe(true);
    const text = (result.payload as any).update.content.text as string;
    expect(text.length).toBeLessThan(200);
    expect(text.endsWith('...[truncated]')).toBe(true);
  });

  it('marks_payload_as_truncated_when_limit_exceeded', () => {
    const payload = {
      update: {
        sessionUpdate: 'tool_call_update',
        rawOutput: 'x'.repeat(256),
      },
    };

    const result = limitOutputSize(payload, 64);
    expect(result.truncated).toBe(true);
  });
});
