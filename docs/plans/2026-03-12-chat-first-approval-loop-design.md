# 2026-03-12 Chat-first Approval Loop Design

## Goal

Turn the new execution-policy runtime gates for `git` and `external` actions into a minimal chat-first approval loop, without introducing a global approval center or rewriting the existing tool/runtime stack.

## Scope

This slice is intentionally small:

- keep the current Route A control-plane / execution-plane split
- keep tools visible to the model
- enforce approval at runtime entry when `requiresConfirmation = true`
- surface a deterministic user-facing approval prompt in chat
- allow the current conversation to resolve the pending approval with natural phrases

Out of scope for this slice:

- cross-session approvals
- durable approval queues beyond the session snapshot
- UI buttons / channel-native approval widgets
- unifying with the existing `/approve` infrastructure
- a full permission engine rewrite

## Approach Options

### Option A — Runtime error only

Let runtime gates keep throwing errors and rely on generic tool-error rendering.

- Pros: smallest code change
- Cons: poor UX, no structured resume path, hard to distinguish from ordinary failures

### Option B — Deterministic chat-first approval loop (recommended)

Add a narrow approval state to the existing `taskRouter` session snapshot, emit a deterministic approval prompt when the runtime gate trips, and teach the router/control path to understand confirmation/rejection phrases.

- Pros: preserves Route A architecture, minimal new state, user-visible behavior feels intentional
- Cons: still local to the current session, not a global approval framework

### Option C — Reuse full `/approve` infra immediately

Translate these policy gates into the existing exec approval pipeline.

- Pros: maximal reuse of a mature approval path
- Cons: larger integration cost, drags this slice into broader gateway/operator semantics too early

Recommendation: **Option B**.

## Design

### 1. Session state

Extend `SessionEntry.taskRouter` with a `pendingApproval` object carrying only the minimum state needed to continue or reject the pending risky action:

- `kind: "git" | "external"`
- `status: "pending" | "resuming"`
- `taskId`
- `runSessionId?`
- `summary`
- `createdAt`
- `resumingAt?`

This keeps approval state attached to the conversation/task snapshot rather than creating a new global registry.

### 2. Runtime gate output

When runtime policy gating detects a blocked action:

- `git` mutation under `requiresConfirmation = true`
- `external` side effect under `requiresConfirmation = true`

it should produce a machine-detectable marker that the payload/render path can convert into a deterministic user prompt.

The prompt should clearly say:

- what kind of action was blocked
- why it was blocked (`requiresConfirmation = true`)
- what the user can reply with next

### 3. Confirmation phrases

Support a small natural-language set:

Confirm:

- `确认执行`
- `可以执行`
- `执行吧`

Reject/hold:

- `先别执行`
- `暂停这个`

These phrases should only be interpreted as approval controls when a `pendingApproval` exists in the current session.

### 4. Control flow

#### Confirmation binding mode (follow-up tightening)

Use a balanced, session-local binding strategy for `confirm_execution`:

1. First try an **exact match** on:
   - `pendingApproval.taskId`
   - `pendingApproval.runSessionId`
   - `pendingApproval.kind`
2. If the run session drifted, allow a **conservative fallback** only when:
   - the same `taskId` is still the latest resumable task
   - the approval `kind` is unchanged
3. If the task context no longer matches, do **not** resume.
   - keep or re-surface the pending approval state
   - tell the user to re-issue the execution request so the system can re-evaluate current state

This keeps the loop smooth for ordinary run-state drift without allowing approvals to float onto unrelated tasks.

#### Approval consumption tightening

Use a minimal two-phase lifecycle:

1. `pending`
   - runtime gate has blocked a risky action
   - waiting for user confirmation or rejection
2. `resuming`
   - the user has confirmed and the next resumed turn may consume this approval exactly once
   - repeated confirmation should not re-open or duplicate the same approval

Consumption rules:

- a matched confirmation transitions `pending -> resuming`
- a resumed run that no longer emits a fresh `pendingApproval` clears the old approval as consumed
- a new execution-bearing task clears any older approval state so stale approvals cannot drift onto a new task
- a rejection clears the approval immediately
- terminal task states (`completed`, `failed`, `cancelled`) clear any approval bound to that task
- a `resuming` approval interrupted by cancellation is cleared instead of falling back to reusable state
- ordinary `continue` / `request_summary` control turns do not consume or revive stale approval state

#### Gate trips

- runtime blocks the risky action
- payload path emits deterministic approval prompt
- reply path persists `pendingApproval` into `sessionEntry.taskRouter`
- task status remains resumable / waiting for user

#### User confirms

- control path recognizes confirmation phrase
- moves `pendingApproval` from `pending` to `resuming`
- rewrites the turn into an internal resume prompt carrying an approval override for the pending action
- run resumes with that one approval context
- once the resumed run is accepted and completes its turn without surfacing a fresh pending approval, the old approval is cleared (consumed)

#### User rejects / holds

- control path recognizes rejection phrase
- clears `pendingApproval`
- task remains `waiting_user`
- user receives a concise acknowledgement that execution is paused until further instruction

### 5. Enforcement model

This slice should stay narrow:

- runtime gate remains the hard boundary
- chat-first approval loop only provides the user-facing control and one-turn continuation signal
- approval does not become a persistent policy escalation; it is scoped to the resumed turn for the pending action

## Testing

Add/extend tests for:

- runtime gate marker generation for `git` and `external`
- deterministic approval prompt rendering
- session snapshot persistence of `pendingApproval`
- phrase recognition for confirm/reject when approval is pending
- clearing approval state on confirm/reject
- resume prompt carrying approval intent forward

## Expected Outcome

After this slice, Route A will support a coherent chat-first approval behavior:

1. the agent explores normally
2. risky `git`/`external` actions trigger runtime gating
3. the user sees a clear deterministic approval prompt
4. the user can answer naturally in chat
5. the run continues or pauses without requiring a global approval subsystem
