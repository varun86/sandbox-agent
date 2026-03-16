import { actor } from "rivetkit";
import { userDb } from "./db/db.js";
import { betterAuthActions } from "./actions/better-auth.js";
import { userActions } from "./actions/user.js";
import {
  createAuthRecordMutation,
  updateAuthRecordMutation,
  updateManyAuthRecordsMutation,
  deleteAuthRecordMutation,
  deleteManyAuthRecordsMutation,
  upsertUserProfileMutation,
  upsertSessionStateMutation,
  upsertTaskStateMutation,
  deleteTaskStateMutation,
} from "./workflow.js";

export const user = actor({
  db: userDb,
  options: {
    name: "User",
    icon: "shield",
    actionTimeout: 60_000,
  },
  createState: (_c, input: { userId: string }) => ({
    userId: input.userId,
  }),
  actions: {
    ...betterAuthActions,
    ...userActions,
    async authCreate(c, body) {
      return await createAuthRecordMutation(c, body);
    },
    async authUpdate(c, body) {
      return await updateAuthRecordMutation(c, body);
    },
    async authUpdateMany(c, body) {
      return await updateManyAuthRecordsMutation(c, body);
    },
    async authDelete(c, body) {
      await deleteAuthRecordMutation(c, body);
      return { ok: true };
    },
    async authDeleteMany(c, body) {
      return await deleteManyAuthRecordsMutation(c, body);
    },
    async profileUpsert(c, body) {
      return await upsertUserProfileMutation(c, body);
    },
    async sessionStateUpsert(c, body) {
      return await upsertSessionStateMutation(c, body);
    },
    async taskStateUpsert(c, body) {
      return await upsertTaskStateMutation(c, body);
    },
    async taskStateDelete(c, body) {
      await deleteTaskStateMutation(c, body);
      return { ok: true };
    },
  },
});
