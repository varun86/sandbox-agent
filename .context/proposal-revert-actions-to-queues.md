# Proposal: Revert Actions-Only Pattern Back to Queues/Workflows

## Background

We converted all actors from queue/workflow-based communication to direct actions as a workaround for a RivetKit bug where `c.queue.iter()` deadlocked for actors created from another actor's context. That bug has since been fixed in RivetKit. We want to revert to queues/workflows because they provide better observability (workflow history in the inspector), replay/recovery semantics, and are the idiomatic RivetKit pattern.

## Reference branches

- **`main`** at commit `32f3c6c3` — the original queue/workflow code BEFORE the actions refactor
- **`queues-to-actions`** — the current refactored code using direct actions
- **`task-owner-git-auth`** at commit `f45a4674` — the merged PR #262 that introduced the actions pattern

Use `main` as the reference for the queue/workflow communication patterns. Use `queues-to-actions` as the reference for bug fixes and new features that MUST be preserved.

## What to KEEP (do NOT revert these)

These are bug fixes and improvements made during the actions refactor that are independent of the communication pattern:

### 1. Lazy task actor creation
- Virtual task entries in org's `taskIndex` + `taskSummaries` tables (no actor fan-out during PR sync)
- `refreshTaskSummaryForBranchMutation` writes directly to org tables instead of spawning task actors
- Task actors self-initialize in `getCurrentRecord()` from `getTaskIndexEntry` when lazily created
- `getTaskIndexEntry` action on org actor
- See CLAUDE.md "Lazy Task Actor Creation" section

### 2. `resolveTaskRepoId` replacing `requireRepoExists`
- `requireRepoExists` was removed — it did a cross-actor call from org to github-data that was fragile
- Replaced with `resolveTaskRepoId` which reads from the org's local `taskIndex` table
- `getTask` action resolves `repoId` from task index when not provided (sandbox actor only has taskId)

### 3. `getOrganizationContext` overrides threaded through sync phases
- `fullSyncBranchBatch`, `fullSyncMembers`, `fullSyncPullRequestBatch` now pass `connectedAccount`, `installationStatus`, `installationId` overrides from `FullSyncConfig`
- Without this, phases 2-4 fail with "Organization not initialized" when the org profile doesn't exist yet (webhook-triggered sync before user sign-in)

### 4. E2B sandbox fixes
- `timeoutMs: 60 * 60 * 1000` in E2B create options (TEMPORARY until rivetkit autoPause lands)
- Sandbox repo path uses `/home/user/repo` for E2B compatibility
- `listProcesses` error handling for expired E2B sandboxes

### 5. Frontend fixes
- React `useEffect` dependency stability in `mock-layout.tsx` and `organization-dashboard.tsx` (prevents infinite re-render loops)
- Terminal pane ref handling

### 6. Process crash protection
- `process.on("uncaughtException")` and `process.on("unhandledRejection")` handlers in `foundry/packages/backend/src/index.ts`

### 7. CLAUDE.md updates
- All new sections: lazy task creation rules, no-silent-catch policy, React hook dependency safety, dev workflow instructions, debugging section

### 8. `requireWorkspaceTask` uses `getOrCreate`
- User-initiated actions (createSession, sendMessage, etc.) use `getOrCreate` to lazily materialize virtual tasks
- The `getOrCreate` call passes `{ organizationId, repoId, taskId }` as `createWithInput`

### 9. `getTask` uses `getOrCreate` with `resolveTaskRepoId`
- When `repoId` is not provided (sandbox actor), resolves from task index
- Uses `getOrCreate` since the task may be virtual

### 10. Audit log deleted workflow file
- `foundry/packages/backend/src/actors/audit-log/workflow.ts` was deleted
- The audit-log actor was simplified to a single `append` action
- Keep this simplification — audit-log doesn't need a workflow

## What to REVERT (communication pattern only)

For each actor, revert from direct action calls back to queue sends with `expectQueueResponse` / fire-and-forget patterns. The reference for the queue patterns is `main` at `32f3c6c3`.

### 1. Organization actor (`foundry/packages/backend/src/actors/organization/`)

**`index.ts`:**
- Revert from actions-only to `run: workflow(runOrganizationWorkflow)`
- Keep the actions that are pure reads (getAppSnapshot, getOrganizationSummarySnapshot, etc.)
- Mutations should go through the workflow queue command loop

**`workflow.ts`:**
- Restore `runOrganizationWorkflow` with the `ctx.loop("organization-command-loop", ...)` that dispatches queue names to mutation handlers
- Restore `ORGANIZATION_QUEUE_NAMES` and `COMMAND_HANDLERS`
- Restore `organizationWorkflowQueueName()` helper

**`app-shell.ts`:**
- Revert direct action calls back to queue sends: `sendOrganizationCommand(org, "organization.command.X", body)` pattern
- Revert `githubData.syncRepos(...)` → `githubData.send(githubDataWorkflowQueueName("syncRepos"), ...)`
- But KEEP the `getOrganizationContext` override threading fix

**`actions/tasks.ts`:**
- Keep `resolveTaskRepoId` (replacing `requireRepoExists`)
- Keep `requireWorkspaceTask` using `getOrCreate`
- Keep `getTask` using `getOrCreate` with `resolveTaskRepoId`
- Keep `getTaskIndexEntry`
- Revert task actor calls from direct actions to queue sends where applicable

**`actions/task-mutations.ts`:**
- Keep lazy task creation (virtual entries in org tables)
- Revert `taskHandle.initialize(...)` → `taskHandle.send(taskWorkflowQueueName("task.command.initialize"), ...)`
- Revert `task.pullRequestSync(...)` → `task.send(taskWorkflowQueueName("task.command.pullRequestSync"), ...)`
- Revert `auditLog.append(...)` → `auditLog.send("auditLog.command.append", ...)`

**`actions/organization.ts`:**
- Revert direct calls to org workflow back to queue sends

**`actions/github.ts`:**
- Revert direct calls back to queue sends

### 2. Task actor (`foundry/packages/backend/src/actors/task/`)

**`index.ts`:**
- Revert from actions-only to `run: workflow(runTaskWorkflow)` (or plain `run` with queue iteration)
- Keep read actions: `get`, `getTaskSummary`, `getTaskDetail`, `getSessionDetail`

**`workflow/index.ts`:**
- Restore `taskCommandActions` as queue handlers in the workflow command loop
- Restore `TASK_QUEUE_NAMES` and dispatch map

**`workspace.ts`:**
- Revert sandbox/org action calls back to queue sends where they were queue-based before

### 3. User actor (`foundry/packages/backend/src/actors/user/`)

**`index.ts`:**
- Revert from actions-only to `run: workflow(runUserWorkflow)` (or plain run with queue iteration)

**`workflow.ts`:**
- Restore queue command loop dispatching to mutation functions

### 4. GitHub-data actor (`foundry/packages/backend/src/actors/github-data/`)

**`index.ts`:**
- Revert from actions-only to having a run handler with queue iteration
- Keep the `getOrganizationContext` override threading fix
- Keep the `actionTimeout: 10 * 60_000` for long sync operations

### 5. Audit-log actor
- Keep as actions-only (simplified). No need to revert — it's simpler with just `append`.

### 6. Callers

**`foundry/packages/backend/src/services/better-auth.ts`:**
- Revert direct user actor action calls back to queue sends

**`foundry/packages/backend/src/actors/sandbox/index.ts`:**
- Revert `organization.getTask(...)` → queue send if it was queue-based before
- Keep the E2B timeout fix and listProcesses error handling

## Step-by-step procedure

1. Create a new branch from `task-owner-git-auth` (current HEAD)
2. For each actor, open a 3-way comparison: `main` (original queues), `queues-to-actions` (current), and your working copy
3. Restore queue/workflow run handlers and command loops from `main`
4. Restore queue name helpers and constants from `main`
5. Restore caller sites to use queue sends from `main`
6. Carefully preserve all items in the "KEEP" list above
7. Test: `cd foundry && docker compose -f compose.dev.yaml up -d`, sign in, verify GitHub sync completes, verify tasks show in sidebar, verify session creation works
8. Nuke RivetKit data between test runs: `docker volume rm foundry_foundry_rivetkit_storage`

## Verification checklist

- [ ] GitHub sync completes (160 repos for rivet-dev)
- [ ] Tasks show in sidebar (from PR sync, lazy/virtual entries)
- [ ] No task actors spawned during sync (check RivetKit inspector — should see 0 task actors until user clicks one)
- [ ] Clicking a task materializes the actor (lazy creation via getOrCreate)
- [ ] Session creation works on sandbox-agent-testing repo
- [ ] E2B sandbox provisions and connects
- [ ] Agent responds to messages
- [ ] No 500 errors in backend logs (except expected E2B sandbox expiry)
- [ ] Workflow history visible in RivetKit inspector for org, task, user actors
- [ ] CLAUDE.md constraints still documented and respected
