# Instructions

## Naming and Ownership

- This repository/product is **Sandbox Agent**.
- **Gigacode** is a separate user-facing UI/client, not the server product name.
- Gigacode integrates with Sandbox Agent via the OpenCode-compatible surface (`/opencode/*`) when that compatibility layer is enabled.
- Canonical extension namespace/domain string is `sandboxagent.dev` (no hyphen).
- Canonical custom ACP extension method prefix is `_sandboxagent/...` (no hyphen).

## Docs Terminology

- Never mention "ACP" in user-facing docs (`docs/**/*.mdx`) except in docs that are specifically about ACP itself (e.g. `docs/acp-http-client.mdx`).
- Never expose underlying protocol method names (e.g. `session/request_permission`, `session/create`, `_sandboxagent/session/detach`) in non-ACP docs. Describe the behavior in user-facing terms instead.
- Do not describe the underlying protocol implementation in docs. Only document the SDK surface (methods, types, options). ACP protocol details belong exclusively in ACP-specific pages.
- Do not use em dashes (`—`) in docs. Use commas, periods, or parentheses instead.

### Docs Source Of Truth (HTTP/CLI)

- For HTTP/CLI docs/examples, source of truth is:
  - `server/packages/sandbox-agent/src/router.rs`
  - `server/packages/sandbox-agent/src/cli.rs`
- Keep docs aligned to implemented endpoints/commands only (for example ACP under `/v1/acp`, not legacy `/v1/sessions` APIs).

## E2E Agent Testing

- When asked to test agents e2e and you do not have the API tokens/credentials required, always stop and ask the user where to find the tokens before proceeding.

## ACP Adapter Audit

- `scripts/audit-acp-deps/adapters.json` is the single source of truth for ACP adapter npm packages, pinned versions, and the `@agentclientprotocol/sdk` pin.
- The Rust fallback install path in `server/packages/agent-management/src/agents.rs` reads adapter entries from `adapters.json` at compile time via `include_str!`.
- Run `cd scripts/audit-acp-deps && npx tsx audit.ts` to compare our pinned versions against the ACP registry and npm latest.
- When bumping an adapter version, update `adapters.json` only — the Rust code picks it up automatically.
- When adding a new agent, add an entry to `adapters.json` (the `_` fallback arm in `install_agent_process_fallback` handles it).
- When updating the `@agentclientprotocol/sdk` pin, update both `adapters.json` (sdkDeps) and `sdks/acp-http-client/package.json`.

## Change Tracking

- If the user asks to "push" changes, treat that as permission to commit and push all current workspace changes, not a hand-picked subset, unless the user explicitly scopes the push.
- Keep CLI subcommands and HTTP endpoints in sync.
- Update `docs/cli.mdx` when CLI behavior changes.
- Regenerate `docs/openapi.json` when HTTP contracts change.
- Keep `docs/inspector.mdx` and `docs/sdks/typescript.mdx` aligned with implementation.
- Append blockers/decisions to `research/acp/friction.md` during ACP work.
- Each agent has its own doc page at `docs/agents/<name>.mdx` listing models, modes, and thought levels. Update the relevant page when changing `fallback_config_options`. To regenerate capability data, run `cd scripts/agent-configs && npx tsx dump.ts`. Source data: `scripts/agent-configs/resources/*.json` and hardcoded entries in `server/packages/sandbox-agent/src/router/support.rs` (`fallback_config_options`).
- Some agent models are gated by subscription (e.g. Claude `opus`). The live report only shows models available to the current credentials. The static doc and JSON resource files should list all known models regardless of subscription tier.

## Adding Providers

When adding a new sandbox provider, update all of the following:

- `sdks/typescript/src/providers/<name>.ts` — provider implementation
- `sdks/typescript/package.json` — add `./<name>` export, peerDependencies, peerDependenciesMeta, devDependencies
- `sdks/typescript/tsup.config.ts` — add entry point and external
- `sdks/typescript/tests/providers.test.ts` — add test entry
- `examples/<name>/` — create example with `src/index.ts` and `tests/<name>.test.ts`
- `docs/deploy/<name>.mdx` — create deploy guide
- `docs/docs.json` — add to Deploy pages navigation
- `docs/quickstart.mdx` — add tab in "Start the sandbox" step, add credentials entry in "Passing LLM credentials" accordion

## Adding Agents

When adding a new agent, update all of the following:

- `docs/agents/<name>.mdx` — create agent page with usage snippet and capabilities table
- `docs/docs.json` — add to the Agents group under Agent
- `docs/quickstart.mdx` — add tab in the "Create a session and send a prompt" CodeGroup

## Persist Packages (Deprecated)

- The `@sandbox-agent/persist-*` npm packages (`persist-sqlite`, `persist-postgres`, `persist-indexeddb`, `persist-rivet`) are deprecated stubs. They still publish to npm but throw a deprecation error at import time.
- Driver implementations now live inline in examples and consuming packages:
  - SQLite: `examples/persist-sqlite/src/persist.ts`
  - Postgres: `examples/persist-postgres/src/persist.ts`
  - IndexedDB: `frontend/packages/inspector/src/persist-indexeddb.ts`
  - Rivet: inlined in `docs/multiplayer.mdx`
  - In-memory: built into the main `sandbox-agent` SDK (`InMemorySessionPersistDriver`)
- Docs (`docs/session-persistence.mdx`) link to the example implementations on GitHub instead of referencing the packages.
- Do not re-add `@sandbox-agent/persist-*` as dependencies anywhere. New persist drivers should be copied into the consuming project directly.

## Install Version References

- Channel policy:
  - Sandbox Agent install/version references use a pinned minor channel `0.N.x` (for curl URLs and `sandbox-agent` / `@sandbox-agent/cli` npm/bun installs).
  - Gigacode install/version references use `latest` (for `@sandbox-agent/gigacode` install/run commands and `gigacode-install.*` release promotion).
  - Release promotion policy: `latest` releases must still update `latest`; when a release is `latest`, Sandbox Agent must also be promoted to the matching minor channel `0.N.x`.
- Keep every install-version reference below in sync whenever versions/channels change:
  - `README.md`
  - `docs/acp-http-client.mdx`
  - `docs/cli.mdx`
  - `docs/quickstart.mdx`
  - `docs/sdk-overview.mdx`
  - `docs/react-components.mdx`
  - `docs/session-persistence.mdx`
  - `docs/deploy/local.mdx`
  - `docs/deploy/cloudflare.mdx`
  - `docs/deploy/vercel.mdx`
  - `docs/deploy/daytona.mdx`
  - `docs/deploy/e2b.mdx`
  - `docs/deploy/docker.mdx`
  - `frontend/packages/website/src/components/GetStarted.tsx`
  - `.claude/commands/post-release-testing.md`
  - `examples/cloudflare/Dockerfile`
  - `examples/daytona/src/index.ts`
  - `examples/shared/src/docker.ts`
  - `examples/docker/src/index.ts`
  - `examples/e2b/src/index.ts`
  - `examples/vercel/src/index.ts`
  - `sdks/typescript/src/providers/shared.ts`
  - `scripts/release/main.ts`
  - `scripts/release/promote-artifacts.ts`
  - `scripts/release/sdk.ts`
  - `scripts/sandbox-testing/test-sandbox.ts`
