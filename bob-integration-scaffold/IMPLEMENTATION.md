# Bob-only fork - integration guide

This folder stages the Bob-specific code so it stays portable and unit-testable
without Bob installed.
Move each piece into the fork as described below.
Branch in progress: `bob-only-fork-scaffold`.

## What is already here (done + tested)

- `src/bobStreamJson.ts` - the `stream-json` NDJSON parser + the `<thinking>`
  splitter (handles tags split across streamed chunks). Dependency-free.
- `src/bobToolMapping.ts` - Bob tool name -> canonical item descriptor, todo
  markdown parser, and the `--chat-mode` enum.
- `test/bobStreamJson.test.ts` - 7 passing tests. Run:
  `node --experimental-strip-types --test bob-integration-scaffold/test/bobStreamJson.test.ts`

These two `src` modules port verbatim into
`apps/server/src/provider/Layers/BobSessionRuntime.ts` (or a sibling
`bobStreamJson.ts`) - they have no t3code dependencies.

## Integration steps (in order)

### 1. Contract: `packages/contracts/src/settings.ts`

Add a `BobSettings` schema next to the other providers (mirror the minimal
`GrokSettings` at lines ~285-303). Keep it small - Bob picks the model, so no
`customModels`/`homePath`:

```ts
export const BobSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("bob").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Bob Shell binary (avoids the bob-nvim PATH collision).",
        providerSettingsForm: { placeholder: "bob", clearWhenEmpty: "omit" },
      }),
    ),
    defaultChatMode: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("code")),
      Schema.annotateKey({ title: "Default chat mode" }),
    ),
  },
  { order: ["binaryPath", "defaultChatMode"] },
);
export type BobSettings = typeof BobSettings.Type;
```

Then register it:
- In `ServerSettings.providers` (line ~396): add `bob: BobSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),`
- Add a `BobSettingsPatch` (mirror `GrokSettingsPatch` ~490) and wire it into the
  providers patch inside `ServerSettingsPatch`.

`ProviderDriverKind` is an open branded slug (`providerInstance.ts:70`), so
`ProviderDriverKind.make("bob")` needs no enum change.

### 2. Contract: `packages/contracts/src/model.ts`

- Add `bob` to `DEFAULT_MODEL_BY_PROVIDER` (e.g. `[BOB_DRIVER_KIND]: "default"`).
- Define the chat-mode option descriptor the UI renders instead of a model
  picker - a `SelectProviderOptionDescriptor` with id `"chatMode"` and options
  `code | plan | advanced | ask` (see `BOB_CHAT_MODES`). The selected value
  rides in `modelSelection.options` as `{ id: "chatMode", value }`.

### 3. Server: `apps/server/src/provider/Layers/BobSessionRuntime.ts`

Mirror `CodexSessionRuntime.ts` but **one process per turn** (Bob is not a
persistent server):

- `spawn(binaryPath, args, { cwd: worktreePath, env })` where `args` =
  `[ ...(resumeIndex ? ["--resume", String(resumeIndex)] : []), prompt,
     "-o", "stream-json", "--chat-mode", mode, "--approval-mode", approvalMode,
     "--trust", "--accept-license" ]`
  (first turn omits `--resume`; capture `init.session_id` / the session index
  and persist it on the thread; later turns pass `--resume <idx>`).
- Read stdout with `readline` (`crlfDelay: Infinity`), feed each line to
  `parseBobStreamJsonLine`, expose results as an Effect `Stream<BobShellEvent>`.
- `result` completes the turn; non-zero exit before `result` is an error.
- `interruptTurn` = kill the child.

### 4. Server: `apps/server/src/provider/Layers/BobAdapter.ts`

Copy `CodexAdapter.ts`'s closure/queue/scope shape; replace
`mapToRuntimeEvents`. Translate Bob events -> canonical `ProviderRuntimeEvent`
(types from `packages/contracts/src/providerRuntime.ts`):

| Bob event | canonical event(s) |
| --- | --- |
| `init` | `thread.started` (`providerThreadId = session_id`); `session.started` on first turn |
| `message` (assistant) | run content through `BobThinkingSplitter`; emit `content.delta` with `streamKind: "reasoning_text"` (reasoning) or `"assistant_text"` (assistant) |
| `tool_use` | `item.started` with `describeBobTool(tool_name).canonicalItemType`; `update_todo_list` -> `turn.plan.updated` (via `parseBobTodoMarkdown`); `attempt_completion` -> assistant `content.delta` from `parameters.result` (+ marks completion) |
| `tool_result` | `item.completed`; for `execute_command` also `content.delta {command_output}`; for edits parse the diff -> `turn.diff.updated` |
| `result` | `turn.completed` (state from `status`) + `thread.token-usage.updated` (from `stats`) |

- `capabilities.sessionModelSwitch = "none"`.
- Stub `respondToRequest` / `respondToUserInput` (Bob one-shot has no
  interactive approvals - see plan). Run auto-approved: `runtimeMode`
  `full-access` -> `--approval-mode yolo`, else `auto_edit`.

Reference `bob-acp-adapter-main/src/bridge/event-mapper.ts` for the exact
diff/terminal/`attempt_completion` handling.

### 5. Server: `apps/server/src/provider/Drivers/BobDriver.ts`

Copy `CodexDriver.ts`. Bundle:
- `snapshot` via `makeManagedServerProvider` - health probe runs
  `bob --version` and checks license/auth state.
- `adapter` = `makeBobAdapter(config, ...)`.
- `textGeneration` = commit/PR/title via a `bob "<prompt>" -o text
  --approval-mode yolo` one-shot, or a minimal stub.
- `BobDriverEnv = ChildProcessSpawner | FileSystem | Path | ServerConfig | ProviderEventLoggers`.

### 6. Server: `apps/server/src/provider/builtInDrivers.ts`

```ts
export const BUILT_IN_DRIVERS = [BobDriver];
export type BuiltInDriversEnv = BobDriverEnv;
```

### 7. Strip the rest (after Bob works end to end)

- Delete `Drivers/{Codex,Claude,Cursor,Grok,OpenCode}*` and their `Layers/` +
  `Services/` adapters; delete `packages/effect-acp` and
  `packages/effect-codex-app-server` (Route 2 needs neither).
- Remove the model picker UI; render the chat-mode select instead. Remove any
  "choose a harness" provider chooser. Hide/neutralize the approval UI.
- Optional: drop `apps/mobile` + relay/SSH/WSL backends for a desktop-only MVP.
- Rebrand: app name, `@t3tools/*` namespace, app id, icons, updater feed.

## Operational reminders (baked into the spawn)

- Always pass `--trust` + `--accept-license` so Bob never blocks headless.
- Seed `.bob/settings.json` in the worktree with
  `{"general":{"checkpointing":{"enabled":false}}}` - t3code owns git
  checkpoints; avoid double bookkeeping.
- Do not pass `--sandbox`; the git worktree is the isolation boundary.
- `binaryPath` is explicit config; never resolve `bob` from PATH.

## Verification ladder

0. Record real `bob "<task>" -o stream-json` fixtures (file edit, command, multi-turn `--resume`).
1. `BobSessionRuntime` parser tests (this folder already covers the core).
2. `BobAdapter.test.ts` - fixtures -> `mapToRuntimeEvents` -> assert canonical events.
3. `BUILT_IN_DRIVERS=[BobDriver]`, `npm run dev:server`, confirm Bob shows available.
4. `npm run dev:desktop` end to end: chat-mode select, streaming text + reasoning,
   a file edit landing in the session worktree, turn completion, approval UI hidden.
5. `npm run typecheck && npm run lint && npm run test`.
