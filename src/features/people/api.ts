import { client } from "../../lib/api/client";
import type { InvitesApi } from "./InvitesManager";

/** Invites on whichever server the app is showing. */
export const serverInvitesApi: InvitesApi = {
  listInvites: async () => (await client.users.listInvites()).invites,
  createInvite: async (input) => (await client.users.createInvite(input)).invite,
  resendInvite: async (inviteId) => (await client.users.resendInvite(inviteId)).invite,
  revokeInvite: (inviteId) => client.users.revokeInvite(inviteId),
};
