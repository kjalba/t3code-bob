import { describe, expect, it } from 'vitest';
import { EventMapper } from '../../src/bridge/event-mapper.js';

describe('event mapper message parsing', () => {
  it('emits_message_and_thought_updates_from_mixed_chunk', () => {
    const mapper = new EventMapper();
    const update = mapper.mapEvent({
      type: 'message',
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: 'before <thinking>secret</thinking> after',
    }, 'sess_1');

    expect(Array.isArray(update)).toBe(true);
    const updates = update as any[];
    expect(updates).toHaveLength(3);
    expect(updates[0]).toMatchObject({ sessionUpdate: 'agent_message_chunk' });
    expect(updates[1]).toMatchObject({ sessionUpdate: 'agent_thought_chunk' });
    expect(updates[2]).toMatchObject({ sessionUpdate: 'agent_message_chunk' });
  });

  it('does_not_drop_additional_updates_from_single_message_event', () => {
    const mapper = new EventMapper();
    const update = mapper.mapEvent({
      type: 'message',
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: '<thinking>secret</thinking>visible',
    }, 'sess_1');

    expect(Array.isArray(update)).toBe(true);
    const updates = update as any[];
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ sessionUpdate: 'agent_thought_chunk' });
    expect(updates[1]).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { text: 'visible' },
    });
  });

  it('filters_empty_tool_banner_messages', () => {
    const mapper = new EventMapper();
    const update = mapper.mapEvent({
      type: 'message',
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: '[using tool attempt_completion: done]',
    }, 'sess_1');

    expect(update).toBeNull();
  });
});
