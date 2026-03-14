import { describe, expect, it } from "vitest";
import { shouldMarkSessionUnreadForStatus, shouldRecreateSessionForModelChange } from "../src/actors/task/workbench.js";

describe("workbench unread status transitions", () => {
  it("marks unread when a running session first becomes idle", () => {
    expect(shouldMarkSessionUnreadForStatus({ thinkingSinceMs: Date.now() - 1_000 }, "idle")).toBe(true);
  });

  it("does not re-mark unread on repeated idle polls after thinking has cleared", () => {
    expect(shouldMarkSessionUnreadForStatus({ thinkingSinceMs: null }, "idle")).toBe(false);
  });

  it("does not mark unread while the session is still running", () => {
    expect(shouldMarkSessionUnreadForStatus({ thinkingSinceMs: Date.now() - 1_000 }, "running")).toBe(false);
  });
});

describe("workbench model changes", () => {
  it("recreates an unused ready session so the selected model takes effect", () => {
    expect(
      shouldRecreateSessionForModelChange({
        status: "ready",
        sandboxSessionId: "session-1",
        created: false,
        transcript: [],
      }),
    ).toBe(true);
  });

  it("does not recreate a session once the conversation has started", () => {
    expect(
      shouldRecreateSessionForModelChange({
        status: "ready",
        sandboxSessionId: "session-1",
        created: true,
        transcript: [],
      }),
    ).toBe(false);
  });

  it("does not recreate pending or anonymous sessions", () => {
    expect(
      shouldRecreateSessionForModelChange({
        status: "pending_session_create",
        sandboxSessionId: "session-1",
        created: false,
        transcript: [],
      }),
    ).toBe(false);
    expect(
      shouldRecreateSessionForModelChange({
        status: "ready",
        sandboxSessionId: null,
        created: false,
        transcript: [],
      }),
    ).toBe(false);
  });
});
