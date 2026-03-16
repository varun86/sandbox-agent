// @ts-nocheck
import { and, desc, eq } from "drizzle-orm";
import { actor } from "rivetkit";
import type { AuditLogEvent } from "@sandbox-agent/foundry-shared";
import { auditLogDb } from "./db/db.js";
import { events } from "./db/schema.js";

export interface AuditLogInput {
  organizationId: string;
}

export interface AppendAuditLogCommand {
  kind: string;
  repoId?: string;
  taskId?: string;
  branchName?: string;
  payload: Record<string, unknown>;
}

export interface ListAuditLogParams {
  repoId?: string;
  branch?: string;
  taskId?: string;
  limit?: number;
}

/**
 * Organization-scoped audit log. One per org, not one per repo.
 *
 * The org is the coordinator for all tasks across repos, and we frequently need
 * to query the full audit trail across repos (e.g. org-wide activity feed,
 * compliance). A per-repo audit log would require fan-out reads every time.
 * Keeping it org-scoped gives us a single queryable feed with optional repoId
 * filtering when callers want a narrower view.
 */
export const auditLog = actor({
  db: auditLogDb,
  options: {
    name: "Audit Log",
    icon: "database",
  },
  createState: (_c, input: AuditLogInput) => ({
    organizationId: input.organizationId,
  }),
  actions: {
    async append(c, body: AppendAuditLogCommand): Promise<{ ok: true }> {
      const now = Date.now();
      await c.db
        .insert(events)
        .values({
          repoId: body.repoId ?? null,
          taskId: body.taskId ?? null,
          branchName: body.branchName ?? null,
          kind: body.kind,
          payloadJson: JSON.stringify(body.payload),
          createdAt: now,
        })
        .run();
      return { ok: true };
    },

    async list(c, params?: ListAuditLogParams): Promise<AuditLogEvent[]> {
      const whereParts = [];
      if (params?.repoId) {
        whereParts.push(eq(events.repoId, params.repoId));
      }
      if (params?.taskId) {
        whereParts.push(eq(events.taskId, params.taskId));
      }
      if (params?.branch) {
        whereParts.push(eq(events.branchName, params.branch));
      }

      const base = c.db
        .select({
          id: events.id,
          repoId: events.repoId,
          taskId: events.taskId,
          branchName: events.branchName,
          kind: events.kind,
          payloadJson: events.payloadJson,
          createdAt: events.createdAt,
        })
        .from(events);

      const rows = await (whereParts.length > 0 ? base.where(and(...whereParts)) : base)
        .orderBy(desc(events.createdAt))
        .limit(params?.limit ?? 100)
        .all();

      return rows.map((row) => ({
        ...row,
        organizationId: c.state.organizationId,
        repoId: row.repoId ?? null,
      }));
    },
  },
});
