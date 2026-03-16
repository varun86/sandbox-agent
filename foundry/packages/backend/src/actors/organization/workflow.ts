// @ts-nocheck
/**
 * Organization command actions — converted from queue handlers to direct actions.
 * Each export becomes an action on the organization actor.
 */
import { applyGithubSyncProgressMutation, recordGithubWebhookReceiptMutation, refreshOrganizationSnapshotMutation } from "./actions.js";
import {
  applyTaskSummaryUpdateMutation,
  createTaskMutation,
  refreshTaskSummaryForBranchMutation,
  registerTaskBranchMutation,
  removeTaskSummaryMutation,
} from "./actions/task-mutations.js";
import {
  betterAuthCreateVerificationMutation,
  betterAuthDeleteAccountIndexMutation,
  betterAuthDeleteEmailIndexMutation,
  betterAuthDeleteManyVerificationMutation,
  betterAuthDeleteSessionIndexMutation,
  betterAuthDeleteVerificationMutation,
  betterAuthUpdateManyVerificationMutation,
  betterAuthUpdateVerificationMutation,
  betterAuthUpsertAccountIndexMutation,
  betterAuthUpsertEmailIndexMutation,
  betterAuthUpsertSessionIndexMutation,
} from "./actions/better-auth.js";
import {
  applyOrganizationFreePlanMutation,
  applyOrganizationStripeCustomerMutation,
  applyOrganizationStripeSubscriptionMutation,
  markOrganizationSyncStartedMutation,
  recordOrganizationSeatUsageMutation,
  setOrganizationBillingPaymentMethodMutation,
  setOrganizationBillingStatusMutation,
  syncOrganizationShellFromGithubMutation,
  updateOrganizationShellProfileMutation,
  upsertOrganizationInvoiceMutation,
} from "./app-shell.js";

export const organizationCommandActions = {
  async commandCreateTask(c: any, body: any) {
    return await createTaskMutation(c, body);
  },
  async commandMaterializeTask(c: any, body: any) {
    return await createTaskMutation(c, body);
  },
  async commandRegisterTaskBranch(c: any, body: any) {
    return await registerTaskBranchMutation(c, body);
  },
  async commandApplyTaskSummaryUpdate(c: any, body: any) {
    await applyTaskSummaryUpdateMutation(c, body);
    return { ok: true };
  },
  async commandRemoveTaskSummary(c: any, body: any) {
    await removeTaskSummaryMutation(c, body);
    return { ok: true };
  },
  async commandRefreshTaskSummaryForBranch(c: any, body: any) {
    await refreshTaskSummaryForBranchMutation(c, body);
    return { ok: true };
  },
  async commandBroadcastSnapshot(c: any, _body: any) {
    await refreshOrganizationSnapshotMutation(c);
    return { ok: true };
  },
  async commandSyncGithubSession(c: any, body: any) {
    const { syncGithubOrganizations } = await import("./app-shell.js");
    await syncGithubOrganizations(c, body);
    return { ok: true };
  },

  // Better Auth index actions
  async commandBetterAuthSessionIndexUpsert(c: any, body: any) {
    return await betterAuthUpsertSessionIndexMutation(c, body);
  },
  async commandBetterAuthSessionIndexDelete(c: any, body: any) {
    await betterAuthDeleteSessionIndexMutation(c, body);
    return { ok: true };
  },
  async commandBetterAuthEmailIndexUpsert(c: any, body: any) {
    return await betterAuthUpsertEmailIndexMutation(c, body);
  },
  async commandBetterAuthEmailIndexDelete(c: any, body: any) {
    await betterAuthDeleteEmailIndexMutation(c, body);
    return { ok: true };
  },
  async commandBetterAuthAccountIndexUpsert(c: any, body: any) {
    return await betterAuthUpsertAccountIndexMutation(c, body);
  },
  async commandBetterAuthAccountIndexDelete(c: any, body: any) {
    await betterAuthDeleteAccountIndexMutation(c, body);
    return { ok: true };
  },
  async commandBetterAuthVerificationCreate(c: any, body: any) {
    return await betterAuthCreateVerificationMutation(c, body);
  },
  async commandBetterAuthVerificationUpdate(c: any, body: any) {
    return await betterAuthUpdateVerificationMutation(c, body);
  },
  async commandBetterAuthVerificationUpdateMany(c: any, body: any) {
    return await betterAuthUpdateManyVerificationMutation(c, body);
  },
  async commandBetterAuthVerificationDelete(c: any, body: any) {
    await betterAuthDeleteVerificationMutation(c, body);
    return { ok: true };
  },
  async commandBetterAuthVerificationDeleteMany(c: any, body: any) {
    return await betterAuthDeleteManyVerificationMutation(c, body);
  },

  // GitHub sync actions
  async commandApplyGithubSyncProgress(c: any, body: any) {
    await applyGithubSyncProgressMutation(c, body);
    return { ok: true };
  },
  async commandRecordGithubWebhookReceipt(c: any, body: any) {
    await recordGithubWebhookReceiptMutation(c, body);
    return { ok: true };
  },
  async commandSyncOrganizationShellFromGithub(c: any, body: any) {
    return await syncOrganizationShellFromGithubMutation(c, body);
  },

  // Shell/profile actions
  async commandUpdateShellProfile(c: any, body: any) {
    await updateOrganizationShellProfileMutation(c, body);
    return { ok: true };
  },
  async commandMarkSyncStarted(c: any, body: any) {
    await markOrganizationSyncStartedMutation(c, body);
    return { ok: true };
  },

  // Billing actions
  async commandApplyStripeCustomer(c: any, body: any) {
    await applyOrganizationStripeCustomerMutation(c, body);
    return { ok: true };
  },
  async commandApplyStripeSubscription(c: any, body: any) {
    await applyOrganizationStripeSubscriptionMutation(c, body);
    return { ok: true };
  },
  async commandApplyFreePlan(c: any, body: any) {
    await applyOrganizationFreePlanMutation(c, body);
    return { ok: true };
  },
  async commandSetPaymentMethod(c: any, body: any) {
    await setOrganizationBillingPaymentMethodMutation(c, body);
    return { ok: true };
  },
  async commandSetBillingStatus(c: any, body: any) {
    await setOrganizationBillingStatusMutation(c, body);
    return { ok: true };
  },
  async commandUpsertInvoice(c: any, body: any) {
    await upsertOrganizationInvoiceMutation(c, body);
    return { ok: true };
  },
  async commandRecordSeatUsage(c: any, body: any) {
    await recordOrganizationSeatUsageMutation(c, body);
    return { ok: true };
  },
};
