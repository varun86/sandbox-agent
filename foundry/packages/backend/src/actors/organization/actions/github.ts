import { desc } from "drizzle-orm";
import type { FoundryAppSnapshot } from "@sandbox-agent/foundry-shared";
import { getOrCreateGithubData, getOrCreateOrganization } from "../../handles.js";
import { authSessionIndex } from "../db/schema.js";
import {
  assertAppOrganization,
  buildAppSnapshot,
  requireEligibleOrganization,
  requireSignedInSession,
  markOrganizationSyncStartedMutation,
} from "../app-shell.js";
import { getBetterAuthService } from "../../../services/better-auth.js";
import { refreshOrganizationSnapshotMutation } from "../actions.js";

export const organizationGithubActions = {
  async resolveAppGithubToken(
    c: any,
    input: { organizationId: string; requireRepoScope?: boolean },
  ): Promise<{ accessToken: string; scopes: string[] } | null> {
    assertAppOrganization(c);
    const auth = getBetterAuthService();
    const rows = await c.db.select().from(authSessionIndex).orderBy(desc(authSessionIndex.updatedAt)).all();

    for (const row of rows) {
      const authState = await auth.getAuthState(row.sessionId);
      if (authState?.sessionState?.activeOrganizationId !== input.organizationId) {
        continue;
      }

      const token = await auth.getAccessTokenForSession(row.sessionId);
      if (!token?.accessToken) {
        continue;
      }

      const scopes = token.scopes;
      if (input.requireRepoScope !== false && scopes.length > 0 && !scopes.some((scope) => scope === "repo" || scope.startsWith("repo:"))) {
        continue;
      }

      return {
        accessToken: token.accessToken,
        scopes,
      };
    }

    return null;
  },

  async triggerAppRepoImport(c: any, input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot> {
    assertAppOrganization(c);
    const session = await requireSignedInSession(c, input.sessionId);
    requireEligibleOrganization(session, input.organizationId);

    const githubData = await getOrCreateGithubData(c, input.organizationId);
    const summary = await githubData.getSummary({});
    if (summary.syncStatus === "syncing") {
      return await buildAppSnapshot(c, input.sessionId);
    }

    const organizationHandle = await getOrCreateOrganization(c, input.organizationId);
    await organizationHandle.commandMarkSyncStarted({ label: "Importing repository catalog..." });
    await organizationHandle.commandBroadcastSnapshot({});

    void githubData.syncRepos({ label: "Importing repository catalog..." }).catch(() => {});

    return await buildAppSnapshot(c, input.sessionId);
  },

  async adminReloadGithubOrganization(c: any): Promise<void> {
    const githubData = await getOrCreateGithubData(c, c.state.organizationId);
    await githubData.syncRepos({ label: "Reloading GitHub organization..." });
  },

  async adminReloadGithubRepository(c: any, input: { repoId: string }): Promise<void> {
    const githubData = await getOrCreateGithubData(c, c.state.organizationId);
    await githubData.reloadRepository(input);
  },
};
