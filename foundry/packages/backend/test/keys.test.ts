import { describe, expect, it } from "vitest";
import { githubDataKey, historyKey, projectBranchSyncKey, projectKey, taskKey, taskSandboxKey, workspaceKey } from "../src/actors/keys.js";

describe("actor keys", () => {
  it("prefixes every key with workspace namespace", () => {
    const keys = [
      workspaceKey("default"),
      projectKey("default", "repo"),
      taskKey("default", "repo", "task"),
      taskSandboxKey("default", "sbx"),
      historyKey("default", "repo"),
      githubDataKey("default"),
      projectBranchSyncKey("default", "repo"),
    ];

    for (const key of keys) {
      expect(key[0]).toBe("ws");
      expect(key[1]).toBe("default");
    }
  });
});
