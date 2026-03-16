import { actor } from "rivetkit";
import { organizationDb } from "./db/db.js";
import { organizationActions } from "./actions.js";
import { organizationCommandActions } from "./workflow.js";

export const organization = actor({
  db: organizationDb,
  options: {
    name: "Organization",
    icon: "compass",
    actionTimeout: 5 * 60_000,
  },
  createState: (_c, organizationId: string) => ({
    organizationId,
  }),
  actions: {
    ...organizationActions,
    ...organizationCommandActions,
  },
});
