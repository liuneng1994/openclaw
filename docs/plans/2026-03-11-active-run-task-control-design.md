# 2026-03-11 Active Run Task Control Design

## Background

OpenClaw Route A has already landed the following incremental slices in `/root/dev/openclaw`:

1. `src/task/` task domain and protocol scaffold
2. task-aware router shim in `src/auto-reply/reply/get-reply-run.ts`
3. task run snapshot write-back for `继续 / 总结一下`
4. minimal pause/cancel wiring for `停一下 / 取消`
5. tightened recovery semantics so `继续` no longer resumes cancelled/completed/failed tasks by mistake

The next gap is that task control decisions are still centered mainly on `latestTask` snapshots. This is workable, but it is not yet closely aligned with the real embedded reply run currently active in the chat-first path.

## Goal

Shift task-control execution decisions from a pure `latestTask` snapshot view toward a **current-session embedded active run** view, while keeping the implementation incremental and low-risk.

The target behavior is:

- `继续` should prefer the most credible resumable task/run in the current session
- `总结一下` should prefer the currently active run when available
- `停一下` should remain conservative, but reflect a real paused/waiting state more consistently
- `取消` should prefer cancelling the real active embedded run when one exists

## Non-Goals

This slice does **not** attempt to:

- unify gateway-wide abort controllers and embedded runs
- introduce a global run registry
- manage cross-session task/run control
- unify subagent / ACP / embedded run control models
- refactor the deeper execution kernel

## Recommended Approach

### Preferred option: reply-flow-centered active-run resolution

Keep control-intent parsing in the existing task router, but move the final execution decision to the reply flow.

- `src/task/router.ts` remains responsible for:
  - intent inference
  - control-action inference
  - task snapshot shaping
  - resumable task selection rules
- `src/auto-reply/reply/get-reply-run.ts` becomes responsible for:
  - checking whether the current session has a credible active embedded run
  - reconciling embedded-run reality with the task snapshot
  - deciding whether to:
    - abort real execution
    - only update task/run snapshot state
    - refuse duplicate continuation
    - or fully fall back to the existing path

This preserves the current architecture:

- router = understanding
- reply flow = execution-time decision

## Alternatives Considered

### Option A — All logic in `get-reply-run.ts` (recommended)

**Pros**

- smallest change surface
- best fits current incremental strategy
- easiest rollback

**Cons**

- `get-reply-run.ts` becomes heavier
- may need later extraction if active-run rules expand

### Option B — Thin helper for active-run resolution

Example shape: `resolveActiveTaskRun(...)`

**Pros**

- cleaner boundary
- easier future reuse

**Cons**

- adds another abstraction now
- slightly wider change surface

**Decision:** Start with Option A. If the branching grows noticeably during implementation, allow a minimal evolution into B.

### Option C — New run registry / unified control layer

**Pros**

- stronger long-term architecture

**Cons**

- clearly too large for this slice
- breaks the minimal, low-risk incremental plan

**Decision:** explicitly deferred.

## Active Run Resolution Rules

Within this slice, “active run” is not introduced as a new durable object. It is a **derived view** built from current session state.

### Evidence sources

Priority order:

1. the current session’s tracked task snapshot (`sessionEntry.taskRouter.latestTask` and `recentTasks`)
2. whether the current session’s embedded reply run is still active
3. consistency between those two views

### Cases

#### Case 1: task snapshot has a run and embedded runtime is active

Treat this as the most credible active run.

Implications:

- control actions should target this run first
- `总结一下` should summarize this run/task pair
- `取消` should abort this run
- `停一下` should mark this run/task as paused/waiting

#### Case 2: task snapshot has a run but embedded runtime is inactive

Treat this as a resumable or historical task state, not an active run.

Implications:

- `继续` may resume the task
- `总结一下` may summarize recent task state
- `取消` becomes snapshot-only if no active run exists
- `停一下` becomes snapshot-only if no active run exists

#### Case 3: embedded runtime is active but task snapshot is incomplete or unclear

Do **not** invent a new mapping aggressively.

Implications:

- allow `取消` to use the existing abort path
- update task snapshot only when the target task can be identified confidently
- otherwise return a conservative acknowledgement without mutating the wrong task

## Control Semantics

### `继续`

Recommended behavior:

- prefer the latest credible resumable task/run in the current session
- if an embedded run is still active, do **not** start duplicate execution
- instead, either summarize/acknowledge current progress or keep the existing path stable

Success condition:

- `继续` should not reopen a cancelled task
- `继续` should not duplicate an already-active embedded run

### `总结一下`

Recommended behavior:

- if a credible active run exists, summarize that run/task first
- otherwise summarize the latest resumable/recent task state
- if neither exists, fall back to the existing normal path

### `停一下`

Recommended behavior:

- remain conservative for this slice
- do not forcibly kill execution
- when task mapping is known:
  - task status → `waiting_user`
  - run snapshot status → `paused`
- when no active run exists, still allow snapshot-only pause state

### `取消`

Recommended behavior:

- if the embedded run is active:
  - use the existing abort path
  - clear the command lane
  - write task/run snapshot as `cancelled`
  - set `abortedLastRun = true`
- if the embedded run is inactive:
  - still allow cancellation
  - but only persist snapshot changes

## Error Handling and Fallback Rules

Conservative fallback is mandatory.

### Rule 1: task known, active run absent

- `继续` → resume task if resumable
- `总结一下` → summarize task state
- `取消` / `停一下` → snapshot-only update

### Rule 2: active run present, task unclear

- `取消` → allow real abort
- task snapshot mutation only if target task can be identified confidently

### Rule 3: neither side is reliable

- fully fall back to the existing message path

The system must never:

- invent a new parallel abort mechanism
- mutate a clearly wrong task snapshot
- duplicate a run that is already active

## Files In Scope

Primary files expected in this slice:

- `src/auto-reply/reply/get-reply-run.ts`
- `src/task/router.ts`
- `src/task/router.test.ts`
- `src/auto-reply/reply/get-reply-run.media-only.test.ts`

Files intentionally out of scope unless implementation proves otherwise:

- `src/gateway/chat-abort.ts`
- `src/gateway/server-chat.ts`
- global run registries
- deeper execution-kernel rewrites

## Testing Plan

### Router tests

Continue extending `src/task/router.test.ts` for:

- resumable task selection rules
- skipping cancelled/completed/failed tasks
- latest-vs-recent fallback behavior

### Reply-flow tests

Extend `src/auto-reply/reply/get-reply-run.media-only.test.ts` for:

- active-run-aware cancel behavior
- snapshot-only cancel fallback when no active run exists
- preventing duplicate execution on `继续` while a run is already active
- summary preference for the current credible active run

### Scope discipline

Do not broaden test coverage into unrelated gateway layers during this slice.

## Success Criteria

This slice is successful if all of the following hold:

1. `继续` does not resume cancelled tasks
2. `继续` does not duplicate a currently active embedded run
3. `总结一下` prefers the active run when one exists
4. `取消` prefers the real active embedded run when one exists
5. `停一下` and `取消` remain semantically distinct
6. uncertain cases still fall back safely to existing behavior

## Implementation Transition

After this design is committed, implementation should proceed as a minimal Route A increment focused on the chat-first embedded reply path only.
