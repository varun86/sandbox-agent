import type { BranchSnapshot } from "./integrations/git/index.js";
import type { PullRequestSnapshot } from "./integrations/github/index.js";
import {
  validateRemote,
  ensureCloned,
  fetch,
  listRemoteBranches,
  remoteDefaultBaseRef,
  revParse,
  ensureRemoteBranch,
  diffStatForBranch,
  conflictsWithMain,
} from "./integrations/git/index.js";
import {
  gitSpiceAvailable,
  gitSpiceListStack,
  gitSpiceRebaseBranch,
  gitSpiceReparentBranch,
  gitSpiceRestackRepo,
  gitSpiceRestackSubtree,
  gitSpiceSyncRepo,
  gitSpiceTrackBranch,
} from "./integrations/git-spice/index.js";
import { listPullRequests, createPr, starRepository } from "./integrations/github/index.js";

export interface GitDriver {
  validateRemote(remoteUrl: string, options?: { githubToken?: string | null }): Promise<void>;
  ensureCloned(remoteUrl: string, targetPath: string, options?: { githubToken?: string | null }): Promise<void>;
  fetch(repoPath: string, options?: { githubToken?: string | null }): Promise<void>;
  listRemoteBranches(repoPath: string, options?: { githubToken?: string | null }): Promise<BranchSnapshot[]>;
  remoteDefaultBaseRef(repoPath: string): Promise<string>;
  revParse(repoPath: string, ref: string): Promise<string>;
  ensureRemoteBranch(repoPath: string, branchName: string, options?: { githubToken?: string | null }): Promise<void>;
  diffStatForBranch(repoPath: string, branchName: string): Promise<string>;
  conflictsWithMain(repoPath: string, branchName: string): Promise<boolean>;
}

export interface StackBranchSnapshot {
  branchName: string;
  parentBranch: string | null;
}

export interface StackDriver {
  available(repoPath: string): Promise<boolean>;
  listStack(repoPath: string): Promise<StackBranchSnapshot[]>;
  syncRepo(repoPath: string): Promise<void>;
  restackRepo(repoPath: string): Promise<void>;
  restackSubtree(repoPath: string, branchName: string): Promise<void>;
  rebaseBranch(repoPath: string, branchName: string): Promise<void>;
  reparentBranch(repoPath: string, branchName: string, parentBranch: string): Promise<void>;
  trackBranch(repoPath: string, branchName: string, parentBranch: string): Promise<void>;
}

export interface GithubDriver {
  listPullRequests(repoPath: string, options?: { githubToken?: string | null }): Promise<PullRequestSnapshot[]>;
  createPr(
    repoPath: string,
    headBranch: string,
    title: string,
    body?: string,
    options?: { githubToken?: string | null },
  ): Promise<{ number: number; url: string }>;
  starRepository(repoFullName: string, options?: { githubToken?: string | null }): Promise<void>;
}

export interface TmuxDriver {
  setWindowStatus(branchName: string, status: string): number;
}

export interface BackendDriver {
  git: GitDriver;
  stack: StackDriver;
  github: GithubDriver;
  tmux: TmuxDriver;
}

export function createDefaultDriver(): BackendDriver {
  return {
    git: {
      validateRemote,
      ensureCloned,
      fetch,
      listRemoteBranches,
      remoteDefaultBaseRef,
      revParse,
      ensureRemoteBranch,
      diffStatForBranch,
      conflictsWithMain,
    },
    stack: {
      available: gitSpiceAvailable,
      listStack: gitSpiceListStack,
      syncRepo: gitSpiceSyncRepo,
      restackRepo: gitSpiceRestackRepo,
      restackSubtree: gitSpiceRestackSubtree,
      rebaseBranch: gitSpiceRebaseBranch,
      reparentBranch: gitSpiceReparentBranch,
      trackBranch: gitSpiceTrackBranch,
    },
    github: {
      listPullRequests,
      createPr,
      starRepository,
    },
    tmux: {
      setWindowStatus: () => 0,
    },
  };
}
