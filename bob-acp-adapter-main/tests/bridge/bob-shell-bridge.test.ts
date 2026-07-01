import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { BobShellBridge } from '../../src/bridge/bob-shell-bridge.js';

function createResultEventLine(): string {
  return JSON.stringify({
    type: 'result',
    timestamp: new Date().toISOString(),
    status: 'success',
    stats: {
      total_tokens: 1,
      input_tokens: 1,
      output_tokens: 1,
      duration_ms: 1,
      session_costs: 0,
      max_budget: 0,
      budget_spend: 0,
      tool_calls: 0,
    },
  });
}

describe('BobShellBridge lifecycle', () => {
  it('calls_onComplete_once_when_done_and_close_both_fire', async () => {
    const bridge = new BobShellBridge();
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 12345;

    (bridge as any).processManager = {
      spawnBobShell: () => child,
    };

    const onComplete = vi.fn();
    const onUpdate = vi.fn();
    const onError = vi.fn();

    await bridge.executePrompt({
      sessionId: 'sess_1',
      cwd: process.cwd(),
      mode: 'code',
      prompt: 'hello',
      onUpdate,
      onComplete,
      onError,
    });

    child.stdout.write(`${createResultEventLine()}\n`);
    child.stdout.end();

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
