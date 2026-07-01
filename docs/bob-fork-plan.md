# Understanding t3code + Architecture Plan for a Bob-only fork

## Context

You want two things:

1. A complete technical understanding of **t3code** (an MIT-licensed, open-source alternative to conductor.build) so you can defend it in depth to an interviewer or PM.
2. A high-level architecture plan to build your **own** version that allows **only IBM Bob** as the agent harness, where Bob auto-selects the model and exposes fewer call-time options than other harnesses.

You confirmed: Bob is driven via a **CLI over stdio** (like Codex/Claude), you only need a **desktop** app, and you want the deeper teaching first, then the plan.

This document captures the understanding (as durable reference) and the recommended implementation approach.

---

## Part 1 - How t3code works (reference)

### The one-line model
A desktop **coordinator** that runs multiple AI coding harnesses (Claude Code, Codex, Cursor, Grok, OpenCode) in parallel, each isolated in its own **git worktree**, presented through one unified UI. It does not call an LLM directly - it supervises harness *processes* and normalizes their protocols.

### Three-tier architecture
```
CLIENTS  (React UI: Electron desktop, browser, mobile)
   | WebSocket (typed JSON-RPC requests + ordered push events)
SERVER   (apps/server, Node.js - owns ALL state, git, persistence, agent lifecycle)
   | stdio (JSON-RPC or ACP), one child process per agent session
PROVIDERS (the actual agent CLIs: codex, claude, cursor, grok, opencode)
```
- The **server is the brain**; clients are thin renderers subscribing to state. Same React app serves desktop/web/mobile.
- Each agent session is a **separate OS child process** spoken to over stdin/stdout.
- Written entirely in **Effect** (TS effect-system: typed errors, DI via "Layers"/the R channel, resource-safe scopes).

### Monorepo layout (pnpm workspaces)
- `apps/server` - the coordinator (most of the logic)
- `apps/web` - shared React UI (TanStack Router, Effect Atoms for state, Zustand for trivial UI state)
- `apps/desktop` - Electron shell: spawns the server, OS integration, preview browser, WSL/Windows/SSH backends
- `apps/mobile` - React Native/Expo
- `packages/contracts` - schema-only source of truth for every type + WS message
- `packages/effect-acp`, `packages/effect-codex-app-server` - Effect bindings for the two agent protocols
- `packages/shared`, `packages/client-runtime` - utilities + shared client connection/state logic

### The provider abstraction (the heart - and what you replace)
Three concepts in `apps/server/src/provider/`:
- **`ProviderDriver`** (`ProviderDriver.ts`) - a plain value (not a singleton service) = the recipe for one harness kind. Has `driverKind`, `configSchema`, `defaultConfig`, and `create(input) => ProviderInstance`.
- **`ProviderInstance`** - a running materialization bundling three closures: `snapshot` (health/capabilities), `adapter` (session/turn work), `textGeneration` (commit/PR text).
- **`ProviderAdapterShape`** (`Services/ProviderAdapter.ts`) - the uniform interface every harness satisfies: `startSession, sendTurn, interruptTurn, respondToRequest, respondToUserInput, stopSession, readThread, rollbackThread, stopAll, streamEvents`.

Registration point: **`apps/server/src/provider/builtInDrivers.ts`** lists `[CodexDriver, ClaudeDriver, CursorDriver, GrokDriver, OpenCodeDriver]`. This single array is the "which harnesses ship" switch.

### Provider lifecycle (CLI-over-stdio path, the Bob template)
Using Codex (`Drivers/CodexDriver.ts` + `Layers/CodexAdapter.ts` + `Layers/CodexSessionRuntime.ts`):
1. Registry calls `CodexDriver.create()` -> `makeCodexAdapter(config)`.
2. The adapter is a closure holding `sessions: Map<ThreadId, ctx>` and a `Queue<ProviderRuntimeEvent>`.
3. `startSession` builds runtime input (`cwd` = the worktree path, `binaryPath`, `model`), creates a `Scope`, spawns the child process via `makeCodexSessionRuntime` (stdio JSON-RPC, ~1400 LOC), forks a fiber that runs `mapToRuntimeEvents` over native events into the queue, then `runtime.start()`.
4. **`mapToRuntimeEvents` (CodexAdapter.ts:489-1337)** is the giant translation table: native protocol vocabulary -> ~62 canonical `ProviderRuntimeEvent` types (`content.delta`, `turn.completed`, `request.opened`, etc.). The adapter is the ONLY place that knows the harness wire format.
5. `streamEvents` (`Stream.fromQueue`) is consumed by `ProviderRuntimeIngestion`, normalized into orchestration events.

### Worktree isolation
Each session gets its own `git worktree add -b <branch> <path> <baseRef>` (`apps/server/src/vcs/GitVcsDriverCore.ts`), real `git` CLI, on its own branch. This is what allows N agents on one repo without conflicts.

### Orchestration = event sourcing + projections
- All actions are immutable events appended to `orchestration_events` (SQLite via `node:sqlite`).
- Read models (`projection_threads`, `projection_thread_messages`, `projection_turns`, ...) are derived by replay. Gives rollback ("rewind a turn"), audit, deterministic tests.
- Domain vocabulary: **Project** (repo) -> **Thread/Session** (one agent in one worktree) -> **Turn** (one prompt + all response events) -> **Message/Activity**.

### Transport + reliability patterns
- `ServerPushBus`: ordered, sequenced push events on typed channels (`server.welcome`, `orchestration.domainEvent`, `terminal.event`), schema-validated at the boundary (`wsTransport.ts`).
- `DrainableWorker`: queue-backed ordered async workers (no timing races). "Runtime receipts": typed completion signals (`checkpointComplete`, `turnQuiescent`) so code waits on events, not polling.

### Desktop shell (Electron, NOT Tauri)
`apps/desktop` spawns the `t3` server as a child process, opens a window over `ws://localhost`, and adds native menus, auto-update, the embedded-Chromium **preview browser** (Playwright automation/recording), and multiple server backends (native/WSL/SSH/Tailscale). Main<->renderer use typed IPC channels separate from the server WebSocket.

---

## Part 2 - Recommended approach for the Bob-only app

### Decision: FORK t3code (do not start from scratch)
Rationale:
- **MIT licensed** (`LICENSE`) - forking, rebranding, and closed-sourcing are all permitted.
- The value is concentrated in the **harness-agnostic core** (worktree isolation, event-sourced orchestration, typed WS transport, React UI, Electron shell, reliability patterns). Rebuilding that is months of work and the hard part.
- The Bob-specific work is **isolated to one well-bounded layer** (the provider drivers). The abstraction was explicitly designed for "swap the harness."
- From-scratch would only win if you wanted to avoid the Effect framework learning curve - but you lose far more than you save.

Trade-off to accept: you must climb the **Effect** learning curve and the codebase's conventions. Budget time for that; it is the main cost of the fork path.

### What you KEEP essentially unchanged
- `packages/contracts` (the canonical `ProviderRuntimeEvent`, orchestration, ws schemas)
- The orchestration engine, event store, projections, checkpointing
- The VCS/worktree layer
- The WebSocket transport + push bus + client-runtime
- `apps/web` UI shell and `apps/desktop` Electron shell
- The `ProviderDriver` / `ProviderInstance` / `ProviderAdapterShape` contracts

### Bob lineage (high-value context)
Bob Shell is almost certainly an **IBM rebrand of Google's Gemini CLI** (Apache-2.0, open source). Evidence: `.bobignore` (cf. `.geminiignore`), layered `settings.json`, `AGENTS.md`/`CONTEXT.md` context files, `--yolo`, `--approval-mode=auto_edit`, `--allowed-tools`, `run_shell_command(git)` allowlist syntax, `usePty`, `sandbox: docker` + `sandbox.Dockerfile`, `discoveryMaxDirs`, themes, "loading phrases", checkpointing, `mcpServers` config shape. Implication: when Bob's docs are silent, **read Gemini CLI's source** to learn its real behavior, including any hidden headless/streaming/ACP modes.

### RESOLVED: Bob's headless interface (verified on Bob Shell v1.0.5)
Bob has a fully sufficient machine-readable mode. Verified facts:
- **Headless**: `bob "<prompt>"` runs one-shot by default (positional arg; the old `-p/--prompt` is deprecated).
- **`-o, --output-format text|json|stream-json`**: `stream-json` emits a newline-delimited JSON (NDJSON) event stream. This is the integration surface.
- **`-r, --resume latest|<index>`**, `--list-sessions`, `--delete-session`: per-project session continuity.
- **`--chat-mode plan|code|advanced|ask|...`**, **`-m/--model`** (Bob has a default model; override optional).
- Approvals: `--approval-mode default|auto_edit|yolo`, `-y/--yolo`, `--allowed-tools`, `--pre-check-auto-approved`.
- Headless hygiene: `--trust`, `--accept-license`, `--instance-id`, `--team-id`, `--max-coins` (cost cap), `--include-directories`.
- Subcommands: `bob mcp`, `bob extensions`.

**Bob `stream-json` event vocabulary** (the real spec, from `bob-acp-adapter-main/src/bridge/output-parser.ts` - only 5 types, one JSON object per line):
- `init` -> `{ session_id, model }` (emitted first; gives Bob's session id + chosen model)
- `message` -> `{ role: "user"|"assistant", content, delta? }` (reasoning is `<thinking>...</thinking>` **embedded inside `content`**, not a separate type; tags can span chunks)
- `tool_use` -> `{ tool_name, tool_id, parameters }`
- `tool_result` -> `{ tool_id, status: "success"|"error", output }`
- `result` -> `{ status, stats: { total_tokens, input_tokens, output_tokens, duration_ms, session_costs, ... } }` -- **the turn-completion signal**
Bob tools seen: `read_file`, `list_files`, `write_to_file`, `apply_diff`, `search_and_replace`, `execute_command`, `switch_mode`, `update_todo_list`, `attempt_completion` (final answer), plus others.

### The bob-acp-adapter (vendored at `bob-acp-adapter-main/`) - use as REFERENCE, not as a dependency
A community POC (Node, `@agentclientprotocol/sdk` 0.16.1) that wraps `bob -o stream-json` and re-exposes it as ACP. Explicitly "not for production." Its value to us is as the **reverse-engineered spec** for Bob's output: `output-parser.ts` (event types), `event-mapper.ts` (tool->kind mappings, `<thinking>` state machine, diff/terminal handling), and `TURN_TYPES.md`. The exact command it runs (our template): `bob [--resume <idx> --prompt <p> | <p>] --output-format stream-json --chat-mode <mode> --approval-mode yolo`, spawned with `cwd`, stdout read line-by-line.
Its hard limits (which are Bob-CLI limits, not adapter bugs): **no interactive approvals, no mid-run questions, no `session/load`.**

### Recommended integration: Route 2 - native stream-json adapter
- **Route 1 (fast demo):** register `bobshell-acp.sh` as an ACP provider and reuse t3code's `packages/effect-acp` path (like Grok/Cursor). Least new code, but ships a third-party POC, adds a triple-process chain (t3code -> adapter -> bob), and needs ACP-version validation (t3code effect-acp speaks `protocolVersion 1`).
- **Route 2 (RECOMMENDED - the product foundation):** a native `BobAdapter` that spawns `bob -o stream-json` directly and maps its 5 events straight to canonical `ProviderRuntimeEvent`s, porting the adapter's `output-parser.ts`/`event-mapper.ts` logic into Effect. Fewer moving parts, no POC in the supply chain, emits canonical events directly (skips the Bob->ACP->canonical double hop). Aligns with the priority of robustness/maintainability over dev cost; only ~5 event types to parse.
- (Optional: build Route 1 first as a throwaway spike to validate Bob end-to-end, then build Route 2 for real.)

### Per-turn process model (key structural difference from Codex)
Bob is **one process per turn**, not a persistent app-server. Model the adapter accordingly:
- `startSession`: lightweight - record `{ threadId, cwd (worktree path), bobSessionIndex? }`. No persistent process.
- `sendTurn`: spawn `bob [--resume <idx>] "<prompt>" -o stream-json --chat-mode <mode> --approval-mode <...> --trust --accept-license` with `cwd = worktree path`; read stdout NDJSON, push canonical events into the per-instance queue until `result`; the process then exits.
- First turn omits `--resume`; capture `init.session_id`/the session index and persist it on the thread; later turns pass `--resume <idx>`.
- `interruptTurn`: kill the child process. `stopSession`: drop the record. `capabilities.sessionModelSwitch = "none"`.

### Bob -> canonical event mapping (the core of BobAdapter)
- `init` -> `thread.started` (`providerThreadId = session_id`) [+ `session.started` on first turn]
- `message` (assistant): split on `<thinking>` tags -> outside = `content.delta {assistant_text}`, inside = `content.delta {reasoning_text}` (carry a tag state machine across chunks)
- `tool_use` -> `item.started`; map `tool_name` -> canonical type: read_file/list_files -> `read`; write_to_file/apply_diff/search_and_replace -> `file_change` (+ `turn.diff.updated`); execute_command -> `command_execution`; update_todo_list -> `turn.plan.updated`; attempt_completion -> assistant message + turn completion
- `tool_result` -> `item.completed` (+ `content.delta {command_output}` for execute_command; parse diffs for edits)
- `result` -> `turn.completed` (state from `status`) + `thread.token-usage.updated` (from `stats`)

### Approvals - a real product constraint
Bob's one-shot CLI cannot surface interactive approval requests or mid-run questions. Consequences:
- Run Bob auto-approved: `runtimeMode` -> `full-access` => `--approval-mode yolo`; `auto-accept-edits` => `--approval-mode auto_edit`; `approval-required` **cannot be honored** (fall back to `auto_edit` + a UI note, or gate via `--allowed-tools`).
- t3code's approval UI / `respondToRequest` / `respondToUserInput` are **inert for Bob** - stub them.
- **Safety net = the git worktree**: Bob only ever edits an isolated throwaway branch; the user's main checkout is untouched.
- Revisit when Bob ships a richer protocol (ACP/approval support is expected in a future Bob version).

### Model vs mode (Bob auto-picks the model)
- **Remove the model picker.** Let Bob use its default model (or set `-m` from a hidden setting).
- **Expose `--chat-mode` instead** as a t3code `ProviderOptionDescriptor` (a `select`: `plan`/`code`/`advanced`/`ask`) carried per-turn in `modelSelection.options` - a more useful selector that matches Bob's reality.
- Optionally surface `--max-coins` as a per-thread budget setting.

### Bob-specific operational gotchas
- **Pre-trust + license**: pass `--trust` and `--accept-license` on every spawn so Bob never blocks in "safe mode" or on the license prompt.
- **Binary path**: `BobSettings.binaryPath` is explicit config - never rely on PATH (avoids the `bob-nvim` Homebrew collision).
- **Disable Bob's own checkpointing** (`general.checkpointing.enabled=false` via a seeded `.bob/settings.json`) - t3code owns git checkpoints via worktrees; avoid double-bookkeeping.
- **Sandbox off** (`--sandbox` unset) - we already isolate via worktree and want Bob editing the worktree files directly.
- **Per-project session store**: Bob's resume indices live under `.bob/` in the cwd, so each worktree gets its own session space automatically - confirm `--resume <idx>` is scoped per-cwd.

### What you BUILD (Route 2 - native, mirror the Codex path)
1. **`packages/contracts/src/bob*.ts`** - add a `bob` `ProviderDriverKind` and a `BobSettings` schema (`binaryPath`, `defaultChatMode`, optional `model`/`maxCoins`). Mirror `CodexSettings`.
2. **`apps/server/src/provider/Layers/BobSessionRuntime.ts`** - the transport: spawn `bob ... -o stream-json` with `cwd`, read stdout with `readline`, `JSON.parse` each line into the 5-type `BobShellEvent` union. Port `output-parser.ts`. One process per turn (no persistent server).
3. **`apps/server/src/provider/Layers/BobAdapter.ts`** - copy `CodexAdapter.ts`'s closure/queue/scope shape, but use the per-turn-spawn model above. The core work is **`mapToRuntimeEvents`** (the table above), porting `event-mapper.ts`. Stub `respondToRequest`/`respondToUserInput`; `capabilities.sessionModelSwitch="none"`.
4. **`apps/server/src/provider/Drivers/BobDriver.ts`** - copy `CodexDriver.ts`. Bundle `snapshot` (health: `bob --version` + auth/license state), `adapter`, and `textGeneration` (commit/PR text via a `bob "<prompt>" -o text` one-shot, or stub). Declare `BobDriverEnv` (`ChildProcessSpawner | FileSystem | Path | ServerConfig | ProviderEventLoggers`).
5. **`builtInDrivers.ts`** -> `BUILT_IN_DRIVERS = [BobDriver]`.

### What you SIMPLIFY / REMOVE
- **Model picker UI**: remove the model dropdown; replace with the `--chat-mode` selector (above). `modelSelection.model` collapses to a constant (e.g. `"bob"`); keep `instanceId` routing since that is how the server finds the instance.
- **Reasoning-effort / service-tier wiring** in `model.ts` and the Codex adapter - not applicable to Bob.
- `adapter.capabilities.sessionModelSwitch` -> `"none"`; approval/user-input methods stubbed.
- **The other four drivers** and their `Drivers/`/`Layers/`/`Services/` files (Claude/Cursor/Grok/OpenCode), plus `effect-codex-app-server` and `effect-acp` (Route 2 needs neither).
- Any provider-selection UI ("choose which harness") - there is only Bob.
- Optionally drop `apps/mobile` and the relay/SSH/WSL backends for a desktop-only MVP (large complexity reduction).

### Remaining open questions (small)
- **Exact `init`/`message` streaming granularity**: does `message` arrive as deltas (`delta:true`) or whole turns? Confirm from a recorded `stream-json` run; affects buffering in the parser.
- **Resume scoping**: confirm `--resume <idx>` is per-cwd so worktrees do not collide.
- **Auth/license model**: how Bob authenticates (env var? `--logout` implies stored credentials) - feeds the health snapshot and spawn env.
- **Rebranding scope**: name, `@t3tools/*` package namespace, app id, icons, updater feed.

---

## Verification (how to prove each step works)

Work bottom-up, leaning on the existing test patterns (every adapter has a `*.test.ts`):
0. **Record fixtures**: capture a few real `bob "<task>" -o stream-json --approval-mode yolo` runs (one with a file edit, one with `execute_command`, one multi-turn via `--resume`) as NDJSON fixtures.
1. **Parser**: `BobSessionRuntime.test.ts` feeds the recorded NDJSON and asserts the 5-type `BobShellEvent` union is parsed (incl. `<thinking>` spanning chunks). Mirror `CodexSessionRuntime.test.ts`.
2. **Event mapping** (highest-value test): `BobAdapter.test.ts` runs fixtures through `mapToRuntimeEvents` and asserts canonical `ProviderRuntimeEvent` output (content deltas, tool items, diff, token usage, turn completion).
3. **Registry wiring**: with `BUILT_IN_DRIVERS = [BobDriver]`, run `npm run dev:server` and confirm the provider snapshot reports Bob available (binary found, license accepted).
4. **End-to-end** (per your global rule - reproduce as a real user): `npm run dev:desktop`, create a project, start a Bob thread, pick a chat-mode, send a prompt; verify streaming text + reasoning, a file edit landing in the session's git worktree, and turn completion. Confirm the approval UI is correctly hidden/no-op for Bob. Be picky about UI polish.
5. **Regression**: `npm run typecheck`, `npm run lint`, `npm run test`; fix any failures or flakiness, even if pre-existing.

---

## Part 3 - Handoff package (ready to import to the build machine)

### 3a. Reference implementation: `BobAdapter` event mapping (Route 2)

Grounded in the real canonical schema (`packages/contracts/src/providerRuntime.ts`).
`BobSessionRuntime` (sibling file) spawns `bob`, reads stdout via `readline`,
calls `parseBobStreamJsonLine`, and **stamps each event with an `EventId`
(Effect `Crypto`) + `createdAt` (Effect `Clock`)** so the mapper below stays
pure (the repo's Effect lint forbids global `Date`/`crypto` in mappers). It
emits an envelope:

```ts
interface BobRuntimeEvent {
  readonly id: EventId;          // minted in the runtime via Effect Crypto
  readonly createdAt: IsoDateTime; // Effect Clock
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly event: BobShellEvent; // from bobStreamJson.ts (the 5 types)
}
```

The mapper (canonical event shapes verified against `providerRuntime.ts`):

```ts
// apps/server/src/provider/Layers/BobAdapter.ts (mapping core)
import {
  type CanonicalItemType, ProviderDriverKind, type ProviderRuntimeEvent,
  RuntimeItemId,
} from "@t3tools/contracts";
import { describeBobTool, parseBobTodoMarkdown } from "./bobToolMapping.ts";
import { BobThinkingSplitter } from "./bobStreamJson.ts";

const PROVIDER = ProviderDriverKind.make("bob");

// `raw` is omitted: RuntimeEventRawSource is a closed union with no Bob member.
// To retain raw for debugging, add Schema.Literal("bob.stream-json") to
// RuntimeEventRawSource in providerRuntime.ts and set raw here.
const base = (evt: BobRuntimeEvent): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
  eventId: evt.id,
  provider: PROVIDER,
  threadId: evt.threadId,
  createdAt: evt.createdAt,
  turnId: evt.turnId,
});

const trimOrUndef = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
};

/**
 * Pure mapper for a single Bob event. `message` events use the per-turn
 * `splitter` (stateful across chunks) to separate reasoning from assistant
 * text. `toolNames` correlates a tool_result back to its tool_use so
 * item.completed carries the right itemType.
 */
function mapBobEvent(
  evt: BobRuntimeEvent,
  splitter: BobThinkingSplitter,
  toolNames: Map<string, string>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const b = base(evt);
  const e = evt.event;
  switch (e.type) {
    case "init":
      return [{ ...b, type: "thread.started", payload: { providerThreadId: e.session_id } }];

    case "message": {
      if (e.role !== "assistant") return [];
      return splitter.push(e.content).map((seg) => ({
        ...b,
        type: "content.delta" as const,
        payload: {
          streamKind: seg.kind === "reasoning" ? "reasoning_text" : "assistant_text",
          delta: seg.text,
        },
      }));
    }

    case "tool_use": {
      const d = describeBobTool(e.tool_name);
      toolNames.set(e.tool_id, e.tool_name);
      if (d.isCompletion) {
        const result = typeof e.parameters.result === "string" ? e.parameters.result : "";
        return result
          ? [{ ...b, type: "content.delta", payload: { streamKind: "assistant_text", delta: result } }]
          : [];
      }
      if (d.isPlanUpdate) {
        const md = typeof e.parameters.todos === "string" ? e.parameters.todos : "";
        return [{ ...b, type: "turn.plan.updated", payload: {
          plan: parseBobTodoMarkdown(md).map((x) => ({
            step: x.content,
            status: x.status === "completed" ? "completed" : x.status === "in_progress" ? "inProgress" : "pending",
          })),
        } }];
      }
      const detail = trimOrUndef(
        typeof e.parameters.path === "string" ? e.parameters.path
          : typeof e.parameters.command === "string" ? e.parameters.command : undefined,
      );
      return [{ ...b, itemId: RuntimeItemId.make(e.tool_id), type: "item.started", payload: {
        itemType: d.canonicalItemType as CanonicalItemType,
        status: "inProgress",
        title: e.tool_name,
        ...(detail ? { detail } : {}),
      } }];
    }

    case "tool_result": {
      const d = describeBobTool(toolNames.get(e.tool_id) ?? "");
      const events: ProviderRuntimeEvent[] = [];
      if (d.canonicalItemType === "command_execution") {
        events.push({ ...b, itemId: RuntimeItemId.make(e.tool_id), type: "content.delta",
          payload: { streamKind: "command_output", delta: e.output } });
      }
      // For edits, parse e.output for a unified diff -> turn.diff.updated
      // (port event-mapper.ts diff handling).
      events.push({ ...b, itemId: RuntimeItemId.make(e.tool_id), type: "item.completed", payload: {
        itemType: d.canonicalItemType as CanonicalItemType,
        status: e.status === "success" ? "completed" : "failed",
        ...(trimOrUndef(e.output.slice(0, 2000)) ? { detail: e.output.slice(0, 2000) } : {}),
      } });
      return events;
    }

    case "result": {
      const s = e.stats;
      const out: ProviderRuntimeEvent[] = [];
      if (s?.total_tokens !== undefined) {
        out.push({ ...b, type: "thread.token-usage.updated", payload: { usage: {
          usedTokens: s.total_tokens,
          ...(s.input_tokens !== undefined ? { inputTokens: s.input_tokens } : {}),
          ...(s.output_tokens !== undefined ? { outputTokens: s.output_tokens } : {}),
          ...(s.duration_ms !== undefined ? { durationMs: s.duration_ms } : {}),
        } } });
      }
      out.push({ ...b, type: "turn.completed", payload: {
        state: e.status === "success" ? "completed" : "failed",
      } });
      return out;
    }
  }
}
```

Adapter wrapper notes (copy CodexAdapter.ts's closure/queue/scope shape):
- Hold a per-instance `Queue.unbounded<ProviderRuntimeEvent>()`; `streamEvents = Stream.fromQueue(queue)`.
- `startSession`: record `{ threadId, cwd, bobSessionIndex? }` in a `Map`; spawn nothing.
- `sendTurn`: create a fresh `BobThinkingSplitter` + `toolNames` Map, spawn via `BobSessionRuntime`, `Queue.offerAll(mapBobEvent(evt, splitter, toolNames))` per event; on the `result` event also offer `splitter.flush()` segments (mint fresh `EventId`s in the runtime) before the `turn.completed` passes through; the process exits.
- `interruptTurn`: kill the child. `respondToRequest`/`respondToUserInput`: stub (Bob one-shot has no interactive approvals). `capabilities.sessionModelSwitch = "none"`.

### 3b. Export manifest - what to move to the build machine

The plan file (this document) lives outside the repo (`~/.claude/plans/...`), and
two folders are untracked. Carry all of these:

1. **The fork itself**: push branch `bob-only-fork-scaffold`, or copy the whole
   `t3code/` working tree (it holds the branch).
2. **`bob-integration-scaffold/`** - tested Bob code (`src/bobStreamJson.ts`,
   `src/bobToolMapping.ts`, `test/bobStreamJson.test.ts`) + `IMPLEMENTATION.md`.
3. **`bob-acp-adapter-main/`** - the reference spec (`src/bridge/*`, `TURN_TYPES.md`).
4. **This plan file** - copy it into the fork as `docs/bob-fork-plan.md` so Bob can read it.

On the build machine: `pnpm install`, then `node --experimental-strip-types
--test bob-integration-scaffold/test/bobStreamJson.test.ts` should show 7 passing
tests before anything else.

### 3c. The Bob brief - paste this to Bob verbatim

> You are implementing a Bob-only fork of t3code (an Electron "harness for
> harnesses"). Read `docs/bob-fork-plan.md` (Parts 1-3) and
> `bob-integration-scaffold/IMPLEMENTATION.md` fully before writing code. Also
> read the reference files: `apps/server/src/provider/Drivers/CodexDriver.ts`,
> `apps/server/src/provider/Layers/CodexAdapter.ts`,
> `apps/server/src/provider/Layers/CodexSessionRuntime.ts`, and
> `bob-acp-adapter-main/src/bridge/{output-parser,event-mapper,process-manager}.ts`.
>
> Implement Route 2 (a native adapter that drives `bob -o stream-json`
> directly; do NOT use the ACP adapter or `effect-acp`). Follow
> IMPLEMENTATION.md steps 1-6 in order:
> 1. Add `BobSettings` to `packages/contracts/src/settings.ts` and register it
>    in `ServerSettings.providers` + the patch (mirror `GrokSettings`).
> 2. Add `bob` to `DEFAULT_MODEL_BY_PROVIDER` and a `chatMode` select option
>    descriptor in `packages/contracts/src/model.ts`.
> 3. Create `apps/server/src/provider/Layers/BobSessionRuntime.ts`: port
>    `bob-integration-scaffold/src/bobStreamJson.ts`; spawn one `bob` process
>    per turn with args `[...(resume?["--resume",String(idx)]:[]), prompt, "-o",
>    "stream-json", "--chat-mode", mode, "--approval-mode", approvalMode,
>    "--trust", "--accept-license"]` and `cwd = worktree path`; read stdout with
>    readline; stamp each event with an EventId (Effect Crypto) + createdAt
>    (Effect Clock); expose a `Stream<BobRuntimeEvent>`.
> 4. Create `apps/server/src/provider/Layers/BobAdapter.ts` using the
>    `mapBobEvent` reference in plan Part 3a and CodexAdapter's queue/scope
>    shape. Port `bobToolMapping.ts`. Stub `respondToRequest`/
>    `respondToUserInput`; set `capabilities.sessionModelSwitch = "none"`.
> 5. Create `apps/server/src/provider/Drivers/BobDriver.ts` (copy CodexDriver;
>    health probe = `bob --version`; `textGeneration` via `bob "<p>" -o text
>    --approval-mode yolo` or a stub).
> 6. Set `BUILT_IN_DRIVERS = [BobDriver]` and `BuiltInDriversEnv = BobDriverEnv`
>    in `apps/server/src/provider/builtInDrivers.ts`.
>
> Hard rules: always pass `--trust --accept-license`; never resolve `bob` from
> PATH (use `BobSettings.binaryPath`); do not enable `--sandbox`; seed
> `.bob/settings.json` with checkpointing disabled. Bob's one-shot CLI has no
> interactive approvals - run auto-approved and leave the approval UI inert.
>
> Do NOT delete the other drivers yet. First get Bob green end-to-end:
> `pnpm run typecheck && pnpm run lint && pnpm run test`, then
> `pnpm run dev:desktop` and confirm a real turn streams text, edits a file in
> the worktree, and completes. Only after that, strip the other drivers +
> `effect-acp`/`effect-codex-app-server` and swap the model picker for the
> chat-mode selector. Write a `BobAdapter.test.ts` (fixtures -> `mapBobEvent` ->
> assert canonical events) as the highest-value test. Ask me before large
> deletions or any rebranding.

### 3d. Readiness

This plan is import-ready. It contains: the full t3code architecture (Part 1),
the verified Bob interface + Route 2 design + mapping (Part 2), and the pasteable
adapter code, export manifest, and Bob brief (Part 3). Remaining work genuinely
requires the Bob-equipped machine (a live compiler + real `stream-json` fixtures
to finalize edge cases like diff parsing and streaming granularity).

## Key files index
- Driver SPI: `apps/server/src/provider/ProviderDriver.ts`
- Adapter contract: `apps/server/src/provider/Services/ProviderAdapter.ts`
- Registration: `apps/server/src/provider/builtInDrivers.ts`
- Codex template: `apps/server/src/provider/Drivers/CodexDriver.ts`, `Layers/CodexAdapter.ts`, `Layers/CodexSessionRuntime.ts`
- Canonical events: `packages/contracts/src/providerRuntime.ts`
- Model/options to simplify: `packages/contracts/src/model.ts`
- Worktrees: `apps/server/src/vcs/GitVcsDriverCore.ts`
- Orchestration: `apps/server/src/orchestration/Layers/{OrchestrationEngine,ProviderRuntimeIngestion}.ts`
- Architecture docs: `docs/architecture/overview.md`, `docs/architecture/providers.md`
- Desktop shell: `apps/desktop/src/main.ts`
- Bob output spec (reference): `bob-acp-adapter-main/src/bridge/output-parser.ts` (5 event types), `bob-acp-adapter-main/src/bridge/event-mapper.ts` (tool->kind + thinking parsing), `bob-acp-adapter-main/src/bridge/process-manager.ts` (exact bob flags), `bob-acp-adapter-main/TURN_TYPES.md`
