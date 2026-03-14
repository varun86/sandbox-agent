import type { BackendDriver, GitDriver, GithubDriver, StackDriver, TmuxDriver } from "../../src/driver.js";

export function createTestDriver(overrides?: Partial<BackendDriver>): BackendDriver {
  return {
    git: overrides?.git ?? createTestGitDriver(),
    stack: overrides?.stack ?? createTestStackDriver(),
    github: overrides?.github ?? createTestGithubDriver(),
    tmux: overrides?.tmux ?? createTestTmuxDriver(),
  };
}

export function createTestGitDriver(overrides?: Partial<GitDriver>): GitDriver {
  return {
    validateRemote: async () => {},
    ensureCloned: async () => {},
    fetch: async () => {},
    listRemoteBranches: async () => [],
    remoteDefaultBaseRef: async () => "origin/main",
    revParse: async () => "abc1234567890",
    ensureRemoteBranch: async () => {},
    diffStatForBranch: async () => "+0/-0",
    conflictsWithMain: async () => false,
    ...overrides,
  };
}

export function createTestStackDriver(overrides?: Partial<StackDriver>): StackDriver {
  return {
    available: async () => false,
    listStack: async () => [],
    syncRepo: async () => {},
    restackRepo: async () => {},
    restackSubtree: async () => {},
    rebaseBranch: async () => {},
    reparentBranch: async () => {},
    trackBranch: async () => {},
    ...overrides,
  };
}

export function createTestGithubDriver(overrides?: Partial<GithubDriver>): GithubDriver {
  return {
    listPullRequests: async () => [],
    createPr: async (_repoPath, _headBranch, _title) => ({
      number: 1,
      url: `https://github.com/test/repo/pull/1`,
    }),
    starRepository: async () => {},
    ...overrides,
  };
}

export function createTestTmuxDriver(overrides?: Partial<TmuxDriver>): TmuxDriver {
  return {
    setWindowStatus: () => 0,
    ...overrides,
  };
}
