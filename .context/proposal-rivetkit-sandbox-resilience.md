# Proposal: RivetKit Sandbox Actor Resilience

## Context

The rivetkit sandbox actor (`src/sandbox/actor.ts`) does not handle the case where the underlying cloud sandbox (e.g. E2B VM) is destroyed while the actor is still alive. This causes cascading 500 errors when the actor tries to call the dead sandbox. Additionally, a UNIQUE constraint bug in event persistence crashes the host process.

The sandbox-agent repo (which defines the E2B provider) will be updated separately to use `autoPause` and expose `pause()`/typed errors. This proposal covers the rivetkit-side changes needed to handle those signals.

## Changes

### 1. Fix `persistObservedEnvelope` UNIQUE constraint crash

**File:** `insertEvent` in the sandbox actor's SQLite persistence layer

The `sandbox_agent_events` table has a UNIQUE constraint on `(session_id, event_index)`. When the same event is observed twice (reconnection, replay, duplicate WebSocket delivery), the insert throws and crashes the host process as an unhandled rejection.

**Fix:** Change the INSERT to `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`. Duplicate events are expected and harmless — they should be silently deduplicated at the persistence layer.

### 2. Handle destroyed sandbox in `ensureAgent()`

**File:** `src/sandbox/actor.ts` — `ensureAgent()` function

When the provider's `start()` is called with an existing `sandboxId` and the sandbox no longer exists, the provider throws a typed `SandboxDestroyedError` (defined in the sandbox-agent provider contract).

`ensureAgent()` should catch this error and check the `onSandboxExpired` config option:

```typescript
// New config option on sandboxActor()
onSandboxExpired?: "destroy" | "recreate"; // default: "destroy"
```

**`"destroy"` (default):**
- Set `state.sandboxDestroyed = true`
- Emit `sandboxExpired` event to all connected clients
- All subsequent action calls (runProcess, createSession, etc.) return a clear error: "Sandbox has expired. Create a new task to continue."
- The sandbox actor stays alive (preserves session history, audit log) but rejects new work

**`"recreate"`:**
- Call provider `create()` to provision a fresh sandbox
- Store new `sandboxId` in state
- Emit `sandboxRecreated` event to connected clients with a notice that sessions are lost (new VM, no prior state)
- Resume normal operation with the new sandbox

### 3. Expose `pause` action

**File:** `src/sandbox/actor.ts` — actions

Add a `pause` action that delegates to the provider's `pause()` method. This is user-initiated only (e.g. user clicks "Pause sandbox" in UI to save credits). The sandbox actor should never auto-pause.

```typescript
async pause(c) {
  await c.provider.pause();
  state.sandboxPaused = true;
  c.broadcast("sandboxPaused", {});
}
```

### 4. Expose `resume` action

**File:** `src/sandbox/actor.ts` — actions

Add a `resume` action for explicit recovery. Calls `provider.start({ sandboxId: state.sandboxId })` which auto-resumes if paused.

```typescript
async resume(c) {
  await ensureAgent(c); // handles reconnect internally
  state.sandboxPaused = false;
  c.broadcast("sandboxResumed", {});
}
```

### 5. Keep-alive while sessions are active

**File:** `src/sandbox/actor.ts`

While the sandbox actor has connected WebSocket clients, periodically extend the underlying sandbox TTL to prevent it from being garbage collected mid-session.

- On first client connect: start a keep-alive interval (e.g. every 2 minutes)
- Each tick: call `provider.extendTimeout(extensionMs)` (the provider maps this to `sandbox.setTimeout()` for E2B)
- On last client disconnect: clear the interval, let the sandbox idle toward its natural timeout

This prevents the common case where a user is actively working but the sandbox expires because the E2B default timeout (5 min) is too short. The `timeoutMs` in create options is the initial TTL; keep-alive extends it dynamically.

## Key invariant

**Never silently fail.** Every destroyed/expired/error state must be surfaced to connected clients via events. The actor must always tell the UI what happened so the user can act on it. See CLAUDE.md "never silently catch errors" rule.

## Dependencies

These changes depend on the sandbox-agent provider contract exposing:
- `pause()` method
- `extendTimeout(ms)` method
- Typed `SandboxDestroyedError` thrown from `start()` when sandbox is gone
- `start()` auto-resuming paused sandboxes via `Sandbox.connect(sandboxId)`
