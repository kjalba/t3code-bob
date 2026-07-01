# Prompt for Bob

Paste the block below to Bob **inside the t3code fork** (after you have copied
`bob-integration-scaffold/`, `bob-acp-adapter-main/`, and `docs/bob-fork-plan.md`
into it and run `pnpm install`).

---

You are implementing a **Bob-only fork of t3code** (an Electron "harness for
harnesses"). Before writing any code, read these fully:

- `docs/bob-fork-plan.md` - Parts 1-3 (architecture, Bob interface + Route 2
  design + event mapping, and the pasteable adapter code / export manifest).
- `bob-integration-scaffold/IMPLEMENTATION.md` - the file-by-file steps.
- Reference files:
  `apps/server/src/provider/Drivers/CodexDriver.ts`,
  `apps/server/src/provider/Layers/CodexAdapter.ts`,
  `apps/server/src/provider/Layers/CodexSessionRuntime.ts`, and
  `bob-acp-adapter-main/src/bridge/{output-parser,event-mapper,process-manager}.ts`.

Verify the environment first:
`node --experimental-strip-types --test bob-integration-scaffold/test/bobStreamJson.test.ts`
(7 tests must pass).

Implement **Route 2** - a native adapter that drives `bob -o stream-json`
directly. Do NOT use the ACP adapter or `packages/effect-acp`. Follow
`IMPLEMENTATION.md` steps 1-6 in order:

1. Add a `BobSettings` schema to `packages/contracts/src/settings.ts` and
   register it in `ServerSettings.providers` + the settings patch (mirror
   `GrokSettings`).
2. Add `bob` to `DEFAULT_MODEL_BY_PROVIDER` and a `chatMode` select option
   descriptor in `packages/contracts/src/model.ts`.
3. Create `apps/server/src/provider/Layers/BobSessionRuntime.ts`: port
   `bob-integration-scaffold/src/bobStreamJson.ts`; spawn ONE `bob` process per
   turn with args
   `[...(resume ? ["--resume", String(idx)] : []), prompt, "-o", "stream-json",
   "--chat-mode", mode, "--approval-mode", approvalMode, "--trust",
   "--accept-license"]` and `cwd = worktree path`; read stdout with `readline`;
   stamp each event with an `EventId` (Effect `Crypto`) + `createdAt` (Effect
   `Clock`); expose a `Stream<BobRuntimeEvent>`.
4. Create `apps/server/src/provider/Layers/BobAdapter.ts` using the `mapBobEvent`
   reference in plan Part 3a plus CodexAdapter's queue/scope shape. Port
   `bobToolMapping.ts`. Stub `respondToRequest` / `respondToUserInput`; set
   `capabilities.sessionModelSwitch = "none"`.
5. Create `apps/server/src/provider/Drivers/BobDriver.ts` (copy `CodexDriver`;
   health probe = `bob --version`; `textGeneration` via
   `bob "<prompt>" -o text --approval-mode yolo`, or a stub).
6. Set `BUILT_IN_DRIVERS = [BobDriver]` and `BuiltInDriversEnv = BobDriverEnv`
   in `apps/server/src/provider/builtInDrivers.ts`.

Hard rules:
- Always pass `--trust --accept-license` on every spawn.
- Never resolve `bob` from PATH; use `BobSettings.binaryPath` (avoids the
  `bob-nvim` Homebrew collision).
- Do not enable `--sandbox`; the git worktree is the isolation boundary.
- Seed `.bob/settings.json` in the worktree with checkpointing disabled
  (`{"general":{"checkpointing":{"enabled":false}}}`).
- Bob's one-shot CLI has no interactive approvals - run auto-approved and leave
  t3code's approval UI inert.

Order of work:
- Do NOT delete the other drivers yet. First get Bob green end-to-end:
  `pnpm run typecheck && pnpm run lint && pnpm run test`, then
  `pnpm run dev:desktop` and confirm a real turn streams text, edits a file in
  the session's git worktree, and completes.
- Write `apps/server/src/provider/Layers/BobAdapter.test.ts` (recorded
  `stream-json` fixtures -> `mapBobEvent` -> assert canonical events) as the
  highest-value test.
- Only after Bob works end-to-end, strip the other four drivers +
  `effect-acp` / `effect-codex-app-server`, and swap the model picker for the
  chat-mode selector.
- Ask me before any large deletions or rebranding.
