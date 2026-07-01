/**
 * Bob Shell `--output-format stream-json` parsing.
 *
 * Bob emits newline-delimited JSON (NDJSON), one object per line, with exactly
 * five event shapes. These were reverse-engineered in
 * `bob-acp-adapter-main/src/bridge/output-parser.ts` and match real
 * `bob "<prompt>" -o stream-json` output (Bob Shell v1.0.5):
 *
 *   init        { session_id, model }
 *   message     { role, content, delta? }   // reasoning is <thinking>...</thinking> INSIDE content
 *   tool_use    { tool_name, tool_id, parameters }
 *   tool_result { tool_id, status, output }
 *   result      { status, stats }            // <- the turn-completion signal
 *
 * This module is intentionally dependency-free (plain TypeScript, no Effect) so
 * it ports cleanly into `apps/server/src/provider/Layers/BobSessionRuntime.ts`,
 * where it will be wrapped in an Effect `Stream` over the child process stdout.
 *
 * @module bobStreamJson
 */

export interface BobInitEvent {
  readonly type: "init";
  readonly timestamp?: string;
  readonly session_id: string;
  readonly model?: string;
}

export interface BobMessageEvent {
  readonly type: "message";
  readonly timestamp?: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Present and true when Bob streams the message in incremental chunks. */
  readonly delta?: boolean;
}

export interface BobToolUseEvent {
  readonly type: "tool_use";
  readonly timestamp?: string;
  readonly tool_name: string;
  readonly tool_id: string;
  readonly parameters: Record<string, unknown>;
}

export interface BobToolResultEvent {
  readonly type: "tool_result";
  readonly timestamp?: string;
  readonly tool_id: string;
  readonly status: "success" | "error";
  readonly output: string;
}

export interface BobResultStats {
  readonly total_tokens?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly duration_ms?: number;
  readonly session_costs?: number;
  readonly max_budget?: number;
  readonly budget_spend?: number;
  readonly tool_calls?: number;
}

export interface BobResultEvent {
  readonly type: "result";
  readonly timestamp?: string;
  readonly status: "success" | "error";
  readonly stats?: BobResultStats;
}

export type BobShellEvent =
  | BobInitEvent
  | BobMessageEvent
  | BobToolUseEvent
  | BobToolResultEvent
  | BobResultEvent;

const KNOWN_EVENT_TYPES = new Set<BobShellEvent["type"]>([
  "init",
  "message",
  "tool_use",
  "tool_result",
  "result",
]);

/**
 * Parse one line of Bob `stream-json`. Returns `null` for:
 *   - blank lines,
 *   - non-JSON lines (Bob can emit a banner/log line to stdout before/around
 *     the JSON stream; the caller should drop these rather than crash), and
 *   - JSON whose `type` is not one of the five known events.
 * Never throws.
 */
export function parseBobStreamJsonLine(line: string): BobShellEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !KNOWN_EVENT_TYPES.has(type as BobShellEvent["type"])) {
    return null;
  }
  return parsed as BobShellEvent;
}

/** True when this event signals the turn is finished. */
export function isBobTurnComplete(event: BobShellEvent): event is BobResultEvent {
  return event.type === "result";
}

/** True when the turn finished in an error state. */
export function isBobTurnError(event: BobShellEvent): boolean {
  return event.type === "result" && event.status === "error";
}

// ── <thinking> splitter ───────────────────────────────────────────────────

export type BobContentSegment =
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "assistant"; readonly text: string };

const OPEN_TAG = "<thinking>";
const CLOSE_TAG = "</thinking>";

/**
 * Splits Bob assistant message `content` into `reasoning` (inside
 * `<thinking>...</thinking>`) and `assistant` (everything else) segments.
 *
 * Bob embeds reasoning inline in message content rather than as a distinct
 * event, and when streaming (`delta: true`) a tag can straddle a chunk
 * boundary. This stateful splitter carries a partial-tag suffix across `push`
 * calls so tags are matched even when split. Mirrors the adapter's
 * event-mapper thinking state machine, but emits canonical-ready segments
 * instead of ACP updates.
 *
 * Map the segments downstream to canonical `content.delta` events with
 * `streamKind: "reasoning_text"` (reasoning) or `"assistant_text"` (assistant).
 */
export class BobThinkingSplitter {
  private inThinking = false;
  /** Holds a trailing fragment that might be the start of a tag. */
  private carry = "";

  push(content: string): BobContentSegment[] {
    const out: BobContentSegment[] = [];
    let buf = this.carry + content;
    this.carry = "";

    while (buf.length > 0) {
      const tag = this.inThinking ? CLOSE_TAG : OPEN_TAG;
      const idx = buf.indexOf(tag);

      if (idx === -1) {
        // No complete tag in view. Emit everything except a suffix that could
        // be the beginning of `tag`; carry that suffix to the next chunk.
        const emitEnd = this.safeEmitEnd(buf, tag);
        if (emitEnd > 0) this.emit(out, buf.slice(0, emitEnd));
        this.carry = buf.slice(emitEnd);
        buf = "";
      } else {
        if (idx > 0) this.emit(out, buf.slice(0, idx));
        this.inThinking = !this.inThinking;
        buf = buf.slice(idx + tag.length);
      }
    }
    return out.filter((s) => s.text.length > 0);
  }

  /** Flush any carried fragment (call once at turn completion). */
  flush(): BobContentSegment[] {
    const out: BobContentSegment[] = [];
    if (this.carry.length > 0) {
      this.emit(out, this.carry);
      this.carry = "";
    }
    return out.filter((s) => s.text.length > 0);
  }

  reset(): void {
    this.inThinking = false;
    this.carry = "";
  }

  private emit(out: BobContentSegment[], text: string): void {
    out.push({ kind: this.inThinking ? "reasoning" : "assistant", text });
  }

  /**
   * Index up to which `buf` is safe to emit, holding back only a suffix that
   * is a proper prefix of `tag` (i.e. a possible split tag). Returns
   * `buf.length` when no suffix could begin the tag.
   */
  private safeEmitEnd(buf: string, tag: string): number {
    const maxOverlap = Math.min(tag.length - 1, buf.length);
    for (let n = maxOverlap; n > 0; n--) {
      if (buf.endsWith(tag.slice(0, n))) return buf.length - n;
    }
    return buf.length;
  }
}
