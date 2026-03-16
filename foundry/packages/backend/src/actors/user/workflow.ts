import { eq, count as sqlCount, and } from "drizzle-orm";
import { DEFAULT_WORKSPACE_MODEL_ID } from "@sandbox-agent/foundry-shared";
import { authUsers, sessionState, userProfiles, userTaskState } from "./db/schema.js";
import { buildWhere, columnFor, materializeRow, persistInput, persistPatch, tableFor } from "./query-helpers.js";

export async function createAuthRecordMutation(c: any, input: { model: string; data: Record<string, unknown> }) {
  const table = tableFor(input.model);
  const persisted = persistInput(input.model, input.data);
  await c.db
    .insert(table)
    .values(persisted as any)
    .run();
  const row = await c.db
    .select()
    .from(table)
    .where(eq(columnFor(input.model, table, "id"), input.data.id as any))
    .get();
  return materializeRow(input.model, row);
}

export async function updateAuthRecordMutation(c: any, input: { model: string; where: any[]; update: Record<string, unknown> }) {
  const table = tableFor(input.model);
  const predicate = buildWhere(table, input.where);
  if (!predicate) throw new Error("updateAuthRecord requires a where clause");
  await c.db
    .update(table)
    .set(persistPatch(input.model, input.update) as any)
    .where(predicate)
    .run();
  return materializeRow(input.model, await c.db.select().from(table).where(predicate).get());
}

export async function updateManyAuthRecordsMutation(c: any, input: { model: string; where: any[]; update: Record<string, unknown> }) {
  const table = tableFor(input.model);
  const predicate = buildWhere(table, input.where);
  if (!predicate) throw new Error("updateManyAuthRecords requires a where clause");
  await c.db
    .update(table)
    .set(persistPatch(input.model, input.update) as any)
    .where(predicate)
    .run();
  const row = await c.db.select({ value: sqlCount() }).from(table).where(predicate).get();
  return row?.value ?? 0;
}

export async function deleteAuthRecordMutation(c: any, input: { model: string; where: any[] }) {
  const table = tableFor(input.model);
  const predicate = buildWhere(table, input.where);
  if (!predicate) throw new Error("deleteAuthRecord requires a where clause");
  await c.db.delete(table).where(predicate).run();
}

export async function deleteManyAuthRecordsMutation(c: any, input: { model: string; where: any[] }) {
  const table = tableFor(input.model);
  const predicate = buildWhere(table, input.where);
  if (!predicate) throw new Error("deleteManyAuthRecords requires a where clause");
  const rows = await c.db.select().from(table).where(predicate).all();
  await c.db.delete(table).where(predicate).run();
  return rows.length;
}

export async function upsertUserProfileMutation(
  c: any,
  input: {
    userId: string;
    patch: {
      githubAccountId?: string | null;
      githubLogin?: string | null;
      roleLabel?: string;
      defaultModel?: string;
      eligibleOrganizationIdsJson?: string;
      starterRepoStatus?: string;
      starterRepoStarredAt?: number | null;
      starterRepoSkippedAt?: number | null;
    };
  },
) {
  const now = Date.now();
  await c.db
    .insert(userProfiles)
    .values({
      id: 1,
      userId: input.userId,
      githubAccountId: input.patch.githubAccountId ?? null,
      githubLogin: input.patch.githubLogin ?? null,
      roleLabel: input.patch.roleLabel ?? "GitHub user",
      defaultModel: input.patch.defaultModel ?? DEFAULT_WORKSPACE_MODEL_ID,
      eligibleOrganizationIdsJson: input.patch.eligibleOrganizationIdsJson ?? "[]",
      starterRepoStatus: input.patch.starterRepoStatus ?? "pending",
      starterRepoStarredAt: input.patch.starterRepoStarredAt ?? null,
      starterRepoSkippedAt: input.patch.starterRepoSkippedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        ...(input.patch.githubAccountId !== undefined ? { githubAccountId: input.patch.githubAccountId } : {}),
        ...(input.patch.githubLogin !== undefined ? { githubLogin: input.patch.githubLogin } : {}),
        ...(input.patch.roleLabel !== undefined ? { roleLabel: input.patch.roleLabel } : {}),
        ...(input.patch.defaultModel !== undefined ? { defaultModel: input.patch.defaultModel } : {}),
        ...(input.patch.eligibleOrganizationIdsJson !== undefined ? { eligibleOrganizationIdsJson: input.patch.eligibleOrganizationIdsJson } : {}),
        ...(input.patch.starterRepoStatus !== undefined ? { starterRepoStatus: input.patch.starterRepoStatus } : {}),
        ...(input.patch.starterRepoStarredAt !== undefined ? { starterRepoStarredAt: input.patch.starterRepoStarredAt } : {}),
        ...(input.patch.starterRepoSkippedAt !== undefined ? { starterRepoSkippedAt: input.patch.starterRepoSkippedAt } : {}),
        updatedAt: now,
      },
    })
    .run();
  return await c.db.select().from(userProfiles).where(eq(userProfiles.userId, input.userId)).get();
}

export async function upsertSessionStateMutation(c: any, input: { sessionId: string; activeOrganizationId: string | null }) {
  const now = Date.now();
  await c.db
    .insert(sessionState)
    .values({
      sessionId: input.sessionId,
      activeOrganizationId: input.activeOrganizationId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionState.sessionId,
      set: { activeOrganizationId: input.activeOrganizationId, updatedAt: now },
    })
    .run();
  return await c.db.select().from(sessionState).where(eq(sessionState.sessionId, input.sessionId)).get();
}

export async function upsertTaskStateMutation(
  c: any,
  input: {
    taskId: string;
    sessionId: string;
    patch: {
      activeSessionId?: string | null;
      unread?: boolean;
      draftText?: string;
      draftAttachmentsJson?: string;
      draftUpdatedAt?: number | null;
    };
  },
) {
  const now = Date.now();
  const existing = await c.db
    .select()
    .from(userTaskState)
    .where(and(eq(userTaskState.taskId, input.taskId), eq(userTaskState.sessionId, input.sessionId)))
    .get();

  if (input.patch.activeSessionId !== undefined) {
    await c.db.update(userTaskState).set({ activeSessionId: input.patch.activeSessionId, updatedAt: now }).where(eq(userTaskState.taskId, input.taskId)).run();
  }

  await c.db
    .insert(userTaskState)
    .values({
      taskId: input.taskId,
      sessionId: input.sessionId,
      activeSessionId: input.patch.activeSessionId ?? existing?.activeSessionId ?? null,
      unread: input.patch.unread !== undefined ? (input.patch.unread ? 1 : 0) : (existing?.unread ?? 0),
      draftText: input.patch.draftText ?? existing?.draftText ?? "",
      draftAttachmentsJson: input.patch.draftAttachmentsJson ?? existing?.draftAttachmentsJson ?? "[]",
      draftUpdatedAt: input.patch.draftUpdatedAt === undefined ? (existing?.draftUpdatedAt ?? null) : input.patch.draftUpdatedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userTaskState.taskId, userTaskState.sessionId],
      set: {
        ...(input.patch.activeSessionId !== undefined ? { activeSessionId: input.patch.activeSessionId } : {}),
        ...(input.patch.unread !== undefined ? { unread: input.patch.unread ? 1 : 0 } : {}),
        ...(input.patch.draftText !== undefined ? { draftText: input.patch.draftText } : {}),
        ...(input.patch.draftAttachmentsJson !== undefined ? { draftAttachmentsJson: input.patch.draftAttachmentsJson } : {}),
        ...(input.patch.draftUpdatedAt !== undefined ? { draftUpdatedAt: input.patch.draftUpdatedAt } : {}),
        updatedAt: now,
      },
    })
    .run();

  return await c.db
    .select()
    .from(userTaskState)
    .where(and(eq(userTaskState.taskId, input.taskId), eq(userTaskState.sessionId, input.sessionId)))
    .get();
}

export async function deleteTaskStateMutation(c: any, input: { taskId: string; sessionId?: string }) {
  if (input.sessionId) {
    await c.db
      .delete(userTaskState)
      .where(and(eq(userTaskState.taskId, input.taskId), eq(userTaskState.sessionId, input.sessionId)))
      .run();
    return;
  }
  await c.db.delete(userTaskState).where(eq(userTaskState.taskId, input.taskId)).run();
}
