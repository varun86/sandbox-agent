import { eq } from "drizzle-orm";
import { authAccounts, authSessions, authUsers, sessionState, userProfiles, userTaskState } from "../db/schema.js";
import { materializeRow } from "../query-helpers.js";

export const userActions = {
  // Custom Foundry action — not part of Better Auth.
  async getAppAuthState(c, input: { sessionId: string }) {
    const session = await c.db.select().from(authSessions).where(eq(authSessions.id, input.sessionId)).get();
    if (!session) {
      return null;
    }
    const [user, profile, currentSessionState, accounts] = await Promise.all([
      c.db.select().from(authUsers).where(eq(authUsers.authUserId, session.userId)).get(),
      c.db.select().from(userProfiles).where(eq(userProfiles.userId, session.userId)).get(),
      c.db.select().from(sessionState).where(eq(sessionState.sessionId, input.sessionId)).get(),
      c.db.select().from(authAccounts).where(eq(authAccounts.userId, session.userId)).all(),
    ]);
    return {
      session,
      user: materializeRow("user", user),
      profile: profile ?? null,
      sessionState: currentSessionState ?? null,
      accounts,
    };
  },

  // Custom Foundry action — not part of Better Auth.
  async getTaskState(c, input: { taskId: string }) {
    const rows = await c.db.select().from(userTaskState).where(eq(userTaskState.taskId, input.taskId)).all();
    const activeSessionId = rows.find((row) => typeof row.activeSessionId === "string" && row.activeSessionId.length > 0)?.activeSessionId ?? null;
    return {
      taskId: input.taskId,
      activeSessionId,
      sessions: rows.map((row) => ({
        sessionId: row.sessionId,
        unread: row.unread === 1,
        draftText: row.draftText,
        draftAttachmentsJson: row.draftAttachmentsJson,
        draftUpdatedAt: row.draftUpdatedAt ?? null,
        updatedAt: row.updatedAt,
      })),
    };
  },
};
