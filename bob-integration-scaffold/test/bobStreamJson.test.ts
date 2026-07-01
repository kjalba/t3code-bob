/**
 * Dependency-free tests for the Bob stream-json parser and <thinking> splitter.
 * Run with Node's built-in test runner + type stripping (Node >= 22.6):
 *
 *   node --experimental-strip-types --test bob-integration-scaffold/test/bobStreamJson.test.ts
 *
 * No install, no Bob required. Fixtures are the documented Bob stream-json
 * shapes (from output-parser.ts / TURN_TYPES.md "Example Flow").
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BobThinkingSplitter,
  isBobTurnComplete,
  parseBobStreamJsonLine,
  type BobShellEvent,
} from "../src/bobStreamJson.ts";
import { describeBobTool, parseBobTodoMarkdown } from "../src/bobToolMapping.ts";

test("parses the five known event types", () => {
  const lines = [
    `{"type":"init","session_id":"s1","model":"bob-default"}`,
    `{"type":"message","role":"assistant","content":"Hello"}`,
    `{"type":"tool_use","tool_name":"write_to_file","tool_id":"t1","parameters":{"path":"a.ts"}}`,
    `{"type":"tool_result","tool_id":"t1","status":"success","output":"ok"}`,
    `{"type":"result","status":"success","stats":{"total_tokens":10}}`,
  ];
  const events = lines.map((l) => parseBobStreamJsonLine(l)).filter((e): e is BobShellEvent => !!e);
  assert.equal(events.length, 5);
  assert.equal(events[0]!.type, "init");
  assert.ok(isBobTurnComplete(events[4]!));
});

test("ignores blanks, non-JSON banners, and unknown event types", () => {
  assert.equal(parseBobStreamJsonLine(""), null);
  assert.equal(parseBobStreamJsonLine("   "), null);
  assert.equal(parseBobStreamJsonLine("YOLO mode is enabled."), null);
  assert.equal(parseBobStreamJsonLine(`{"type":"telemetry","foo":1}`), null);
  assert.equal(parseBobStreamJsonLine(`{"no_type":true}`), null);
});

test("splits inline <thinking> from assistant content in one chunk", () => {
  const splitter = new BobThinkingSplitter();
  const segs = splitter.push("<thinking>analyze first</thinking>Here is the fix");
  assert.deepEqual(segs, [
    { kind: "reasoning", text: "analyze first" },
    { kind: "assistant", text: "Here is the fix" },
  ]);
});

test("handles <thinking> tags split across streamed chunks", () => {
  const splitter = new BobThinkingSplitter();
  const out = [
    ...splitter.push("<thin"),
    ...splitter.push("king>reasoning here</think"),
    ...splitter.push("ing>final answer"),
    ...splitter.flush(),
  ];
  assert.deepEqual(out, [
    { kind: "reasoning", text: "reasoning here" },
    { kind: "assistant", text: "final answer" },
  ]);
});

test("treats content outside tags as assistant text", () => {
  const splitter = new BobThinkingSplitter();
  assert.deepEqual(splitter.push("just a plain answer"), [
    { kind: "assistant", text: "just a plain answer" },
  ]);
});

test("maps Bob tools to canonical descriptors", () => {
  assert.equal(describeBobTool("execute_command").canonicalItemType, "command_execution");
  assert.equal(describeBobTool("apply_diff").kind, "edit");
  assert.equal(describeBobTool("read_file").kind, "read");
  assert.equal(describeBobTool("attempt_completion").isCompletion, true);
  assert.equal(describeBobTool("update_todo_list").isPlanUpdate, true);
  assert.equal(describeBobTool("some_future_tool").canonicalItemType, "unknown");
});

test("parses Bob todo markdown into plan entries", () => {
  const entries = parseBobTodoMarkdown("- [x] Analyze\n- [ ] Implement\n- [ ] Test");
  assert.equal(entries.length, 3);
  assert.equal(entries[0]!.status, "completed");
  assert.equal(entries[1]!.status, "in_progress");
});
