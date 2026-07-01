/**
 * Maps Bob Shell tool names to canonical item descriptors.
 *
 * Ported from `bob-acp-adapter-main/src/bridge/event-mapper.ts` +
 * `TURN_TYPES.md`. The `canonicalItemType` strings line up with t3code's
 * `CanonicalItemType` (see `toCanonicalItemType` in
 * `apps/server/src/provider/Layers/CodexAdapter.ts`); when wiring BobAdapter,
 * emit `item.started` / `item.completed` with these types, and use `kind` for
 * UI affordances.
 *
 * Dependency-free so it ports straight into the server adapter.
 *
 * @module bobToolMapping
 */

/** t3code-aligned canonical item types Bob tools fan into. */
export type BobCanonicalItemType =
  | "command_execution"
  | "file_change"
  | "read"
  | "plan"
  | "assistant_message"
  | "mcp_tool_call"
  | "unknown";

export type BobToolKind = "read" | "edit" | "execute" | "switch_mode" | "plan" | "other";

export interface BobToolDescriptor {
  readonly kind: BobToolKind;
  readonly canonicalItemType: BobCanonicalItemType;
  /**
   * `attempt_completion` is special: Bob signals the final answer through it.
   * Its `result` parameter should be emitted as an assistant message, and the
   * tool_result for it suppressed (the adapter does this to avoid duplication).
   */
  readonly isCompletion: boolean;
  /** `update_todo_list` maps to a plan/todo update rather than a tool item. */
  readonly isPlanUpdate: boolean;
  /** `switch_mode` produces a current-mode-update in addition to a tool item. */
  readonly isModeSwitch: boolean;
}

const DEFAULT_DESCRIPTOR: BobToolDescriptor = {
  kind: "other",
  canonicalItemType: "unknown",
  isCompletion: false,
  isPlanUpdate: false,
  isModeSwitch: false,
};

const TABLE: Record<string, BobToolDescriptor> = {
  read_file: { ...DEFAULT_DESCRIPTOR, kind: "read", canonicalItemType: "read" },
  list_files: { ...DEFAULT_DESCRIPTOR, kind: "read", canonicalItemType: "read" },
  write_to_file: { ...DEFAULT_DESCRIPTOR, kind: "edit", canonicalItemType: "file_change" },
  apply_diff: { ...DEFAULT_DESCRIPTOR, kind: "edit", canonicalItemType: "file_change" },
  search_and_replace: { ...DEFAULT_DESCRIPTOR, kind: "edit", canonicalItemType: "file_change" },
  execute_command: {
    ...DEFAULT_DESCRIPTOR,
    kind: "execute",
    canonicalItemType: "command_execution",
  },
  switch_mode: {
    ...DEFAULT_DESCRIPTOR,
    kind: "switch_mode",
    canonicalItemType: "unknown",
    isModeSwitch: true,
  },
  update_todo_list: {
    ...DEFAULT_DESCRIPTOR,
    kind: "plan",
    canonicalItemType: "plan",
    isPlanUpdate: true,
  },
  attempt_completion: {
    ...DEFAULT_DESCRIPTOR,
    kind: "other",
    canonicalItemType: "assistant_message",
    isCompletion: true,
  },
};

export function describeBobTool(toolName: string): BobToolDescriptor {
  return TABLE[toolName] ?? DEFAULT_DESCRIPTOR;
}

/**
 * Parse Bob's `update_todo_list` markdown checklist into plan entries.
 * `[x]` -> completed, `[ ]`/`[-]` -> in-progress/pending. Mirrors the adapter.
 */
export interface BobPlanEntry {
  readonly content: string;
  readonly status: "completed" | "in_progress" | "pending";
}

export function parseBobTodoMarkdown(markdown: string): readonly BobPlanEntry[] {
  const entries: BobPlanEntry[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^[-*]?\s*\[([ xX-])\]\s+(.*)$/.exec(line);
    if (!match) continue;
    const mark = match[1];
    const content = match[2]?.trim() ?? "";
    if (content.length === 0) continue;
    const status: BobPlanEntry["status"] =
      mark === "x" || mark === "X" ? "completed" : "in_progress";
    entries.push({ content, status });
  }
  return entries;
}

/** The Bob `--chat-mode` values, surfaced in the UI as a select option. */
export const BOB_CHAT_MODES = ["code", "plan", "advanced", "ask"] as const;
export type BobChatMode = (typeof BOB_CHAT_MODES)[number];
export const DEFAULT_BOB_CHAT_MODE: BobChatMode = "code";
