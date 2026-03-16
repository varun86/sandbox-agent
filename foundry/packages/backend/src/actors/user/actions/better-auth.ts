import { asc, count as sqlCount, desc } from "drizzle-orm";
import { applyJoinToRow, applyJoinToRows, buildWhere, columnFor, tableFor } from "../query-helpers.js";

export const betterAuthActions = {
  // Better Auth adapter action — called by the Better Auth adapter in better-auth.ts.
  // Schema and behavior are constrained by Better Auth.
  async betterAuthFindOneRecord(c, input: { model: string; where: any[]; join?: any }) {
    const table = tableFor(input.model);
    const predicate = buildWhere(table, input.where);
    const row = predicate ? await c.db.select().from(table).where(predicate).get() : await c.db.select().from(table).get();
    return await applyJoinToRow(c, input.model, row ?? null, input.join);
  },

  // Better Auth adapter action — called by the Better Auth adapter in better-auth.ts.
  // Schema and behavior are constrained by Better Auth.
  async betterAuthFindManyRecords(c, input: { model: string; where?: any[]; limit?: number; offset?: number; sortBy?: any; join?: any }) {
    const table = tableFor(input.model);
    const predicate = buildWhere(table, input.where);
    let query: any = c.db.select().from(table);
    if (predicate) {
      query = query.where(predicate);
    }
    if (input.sortBy?.field) {
      const column = columnFor(input.model, table, input.sortBy.field);
      query = query.orderBy(input.sortBy.direction === "asc" ? asc(column) : desc(column));
    }
    if (typeof input.limit === "number") {
      query = query.limit(input.limit);
    }
    if (typeof input.offset === "number") {
      query = query.offset(input.offset);
    }
    const rows = await query.all();
    return await applyJoinToRows(c, input.model, rows, input.join);
  },

  // Better Auth adapter action — called by the Better Auth adapter in better-auth.ts.
  // Schema and behavior are constrained by Better Auth.
  async betterAuthCountRecords(c, input: { model: string; where?: any[] }) {
    const table = tableFor(input.model);
    const predicate = buildWhere(table, input.where);
    const row = predicate
      ? await c.db.select({ value: sqlCount() }).from(table).where(predicate).get()
      : await c.db.select({ value: sqlCount() }).from(table).get();
    return row?.value ?? 0;
  },
};
