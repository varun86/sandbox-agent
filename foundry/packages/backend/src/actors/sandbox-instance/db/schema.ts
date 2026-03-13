import { integer, sqliteTable, text, uniqueIndex } from "rivetkit/db/drizzle";

// SQLite is per sandbox-instance actor instance.
export const sandboxInstance = sqliteTable("sandbox_instance", {
  id: integer("id").primaryKey(),
  // Structured by the provider/runtime metadata serializer for this actor.
  metadataJson: text("metadata_json").notNull(),
  status: text("status").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Persist sandbox-agent sessions/events in SQLite instead of actor state so they survive
// serverless actor evictions and backend restarts.
export const sandboxSessions = sqliteTable("sandbox_sessions", {
  id: text("id").notNull().primaryKey(),
  agent: text("agent").notNull(),
  agentSessionId: text("agent_session_id").notNull(),
  lastConnectionId: text("last_connection_id").notNull(),
  createdAt: integer("created_at").notNull(),
  destroyedAt: integer("destroyed_at"),
  // Structured by the sandbox-agent ACP session bootstrap payload.
  sessionInitJson: text("session_init_json"),
});

export const sandboxSessionEvents = sqliteTable(
  "sandbox_session_events",
  {
    id: text("id").notNull().primaryKey(),
    sessionId: text("session_id").notNull(),
    eventIndex: integer("event_index").notNull(),
    createdAt: integer("created_at").notNull(),
    connectionId: text("connection_id").notNull(),
    sender: text("sender").notNull(),
    // Structured by the sandbox-agent session event envelope.
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [uniqueIndex("sandbox_session_events_session_id_event_index_unique").on(table.sessionId, table.eventIndex)],
);
