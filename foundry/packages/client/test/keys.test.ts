import { describe, expect, it } from "vitest";
import { taskKey, historyKey, projectBranchSyncKey, projectKey, projectPrSyncKey, taskSandboxKey, workspaceKey } from "../src/keys.js";

describe("actor keys", () => {
  it("prefixes every key with workspace namespace", () => {
    const keys = [
      workspaceKey("default"),
      projectKey("default", "repo"),
      taskKey("default", "repo", "task"),
      taskSandboxKey("default", "sbx"),
      historyKey("default", "repo"),
      projectPrSyncKey("default", "repo"),
      projectBranchSyncKey("default", "repo"),
    ];

    for (const key of keys) {
      expect(key[0]).toBe("ws");
      expect(key[1]).toBe("default");
    }
  });
});
