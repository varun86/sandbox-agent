# Proposal: Task Primary Owner & Git Authentication

## Problem

Sandbox git operations (commit, push, PR creation) require authentication.
Currently, the sandbox has no user-scoped credentials. The E2B sandbox
clones repos using the GitHub App installation token, but push operations
need user-scoped auth so commits are attributed correctly and branch
protection rules are enforced.

## Design

### Concept: Primary User per Task

Each task has a **primary user** (the "owner"). This is the last user who
sent a message on the task. Their GitHub OAuth credentials are injected
into the sandbox for git operations. When the owner changes, the sandbox
git config and credentials swap to the new user.

### Data Model

**Task actor DB** -- new `task_owner` single-row table:
- `primaryUserId` (text) -- better-auth user ID
- `primaryGithubLogin` (text) -- GitHub username (for `git config user.name`)
- `primaryGithubEmail` (text) -- GitHub email (for `git config user.email`)
- `primaryGithubAvatarUrl` (text) -- avatar for UI display
- `updatedAt` (integer)

**Org coordinator** -- add to `taskSummaries` table:
- `primaryUserLogin` (text, nullable)
- `primaryUserAvatarUrl` (text, nullable)

### Owner Swap Flow

Triggered when `sendWorkspaceMessage` is called with a different user than
the current primary:

1. `sendWorkspaceMessage(authSessionId, ...)` resolves user from auth session
2. Look up user's GitHub identity from auth account table (`providerId = "github"`)
3. Compare `primaryUserId` with current owner. If different:
   a. Update `task_owner` row in task actor DB
   b. Get user's OAuth `accessToken` from auth account
   c. Push into sandbox via `runProcess`:
      - `git config user.name "{login}"`
      - `git config user.email "{email}"`
      - Write token to `/home/user/.git-token` (or equivalent)
   d. Push updated task summary to org coordinator (includes `primaryUserLogin`)
   e. Broadcast `taskUpdated` to connected clients
4. If same user, no-op (token is still valid)

### Token Injection

The user's GitHub OAuth token (stored in better-auth account table) has
`repo` scope (verified -- see `better-auth.ts` line 480: `scope: ["read:org", "repo"]`).

This is a standard **OAuth App** flow (not GitHub App OAuth). OAuth App
tokens do not expire unless explicitly revoked. No refresh logic is needed.

**Injection method:**

On first sandbox repo setup (`ensureSandboxRepo`), configure:

```bash
# Write token file
echo "{token}" > /home/user/.git-token
chmod 600 /home/user/.git-token

# Configure git to use it
git config --global credential.helper 'store --file=/home/user/.git-token'

# Format: https://{login}:{token}@github.com
echo "https://{login}:{token}@github.com" > /home/user/.git-token
```

On owner swap, overwrite `/home/user/.git-token` with new user's credentials.

**Important: git should never prompt for credentials.** The credential
store file ensures all git operations are auto-authenticated. No
`GIT_ASKPASS` prompts, no interactive auth.

**Race condition (expected behavior):** If User A sends a message and the
agent starts a long git operation, then User B sends a message and triggers
an owner swap, the in-flight git process still has User A's credentials
(already read from the credential store). The next git operation uses
User B's credentials. This is expected behavior -- document in comments.

### Token Validity

OAuth App tokens (our flow) do not expire. They persist until the user
revokes them or the OAuth App is deauthorized. No periodic refresh needed.

If a token becomes invalid (user revokes), git operations will fail with
a 401. The error surfaces through the standard `ensureSandboxRepo` /
`runProcess` error path and is displayed in the UI.

### User Removal

When a user is removed from the organization:
1. Org actor queries active tasks with that user as primary owner
2. For each, clear the `task_owner` row
3. Task actor clears the sandbox git credentials (overwrite credential file)
4. Push updated task summaries to org coordinator
5. Subsequent git operations fail with "No active owner -- assign an owner to enable git operations"

### UI Changes

**Right sidebar -- new "Overview" tab:**
- Add as a new tab alongside "Changes" and "All Files"
- Shows current primary user: avatar, name, login
- Click on the user -> dropdown of all workspace users (from org member list)
- Select a user -> triggers explicit owner swap (same flow as message-triggered)
- Also shows task metadata: branch, repo, created date

**Left sidebar -- task items:**
- Show primary user's GitHub login in green text next to task name
- Only shown when there is an active owner

**Task detail header:**
- Show small avatar of primary user next to task title

### Org Coordinator

`commandApplyTaskSummaryUpdate` already receives the full task summary
from the task actor. Add `primaryUserLogin` and `primaryUserAvatarUrl`
to the summary payload. The org writes it to `taskSummaries`. The sidebar
reads it from the org snapshot.

### Sandbox Architecture Note

Structurally, the system supports multiple sandboxes per task, but in
practice there is exactly one active sandbox per task. Design the owner
injection assuming one sandbox. The token is injected into the active
sandbox only. If multi-sandbox support is needed in the future, extend
the injection to target specific sandbox IDs.

## Security Considerations

### OAuth Token Scope

The user's GitHub OAuth token has `repo` scope, which grants **full control
of all private repositories** the user has access to. When injected into
the sandbox:

- The agent can read/write ANY repo the user has access to, not just the
  task's target repo
- The token persists in the sandbox filesystem until overwritten
- Any process running in the sandbox can read the credential file

**Mitigations:**
- Credential file has `chmod 600` (owner-read-only)
- Sandbox is isolated per-task (E2B VM boundary)
- Token is overwritten on owner swap (old user's token removed)
- Token is cleared on user removal from org
- Sandbox has a finite lifetime (E2B timeout + autoPause)

**Accepted risk:** This is the standard trade-off for OAuth-based git
integrations (same as GitHub Codespaces, Gitpod, etc.). The user consents
to `repo` scope at sign-in time. Document this in user-facing terms in
the product's security/privacy page.

### Future: Fine-grained tokens

GitHub supports fine-grained personal access tokens scoped to specific
repos. A future improvement could mint per-repo tokens instead of using
the user's full OAuth token. This requires the user to create and manage
fine-grained tokens, which adds friction. Evaluate based on user feedback.

## Implementation Order

1. Add `task_owner` table to task actor schema + migration
2. Add `primaryUserLogin` / `primaryUserAvatarUrl` to `taskSummaries` schema + migration
3. Implement owner swap in `sendWorkspaceMessage` flow
4. Implement credential injection in `ensureSandboxRepo`
5. Implement credential swap via `runProcess` on owner change
6. Implement user removal cleanup in org actor
7. Add "Overview" tab to right sidebar
8. Add owner display to left sidebar task items
9. Add owner picker dropdown in Overview tab
10. Update org coordinator to propagate owner in task summaries

## Files to Modify

### Backend
- `foundry/packages/backend/src/actors/task/db/schema.ts` -- add `task_owner` table
- `foundry/packages/backend/src/actors/task/db/migrations.ts` -- add migration
- `foundry/packages/backend/src/actors/organization/db/schema.ts` -- add owner columns to `taskSummaries`
- `foundry/packages/backend/src/actors/organization/db/migrations.ts` -- add migration
- `foundry/packages/backend/src/actors/task/workspace.ts` -- owner swap logic in `sendWorkspaceMessage`, credential injection in `ensureSandboxRepo`
- `foundry/packages/backend/src/actors/task/workflow/index.ts` -- wire owner swap action
- `foundry/packages/backend/src/actors/organization/actions/task-mutations.ts` -- propagate owner in summaries
- `foundry/packages/backend/src/actors/organization/actions/tasks.ts` -- `sendWorkspaceMessage` owner check
- `foundry/packages/backend/src/services/better-auth.ts` -- expose `getAccessTokenForSession` for owner lookup

### Shared
- `foundry/packages/shared/src/types.ts` -- add `primaryUserLogin` to `TaskSummary`

### Frontend
- `foundry/packages/frontend/src/components/mock-layout/right-sidebar.tsx` -- add Overview tab
- `foundry/packages/frontend/src/components/organization-dashboard.tsx` -- show owner in sidebar task items
- `foundry/packages/frontend/src/components/mock-layout.tsx` -- wire Overview tab state
