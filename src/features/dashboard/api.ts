import type {
  Agent,
  Invite,
  ModelInfo,
  ProviderConfigPublic,
  ServerLogEntry,
  ServerStatus,
  UserAccount,
  UserRole,
} from '@crewly/sdk';
import { client } from '../../lib/api/client';

/**
 * Everything the dashboard does to a server, in one place.
 *
 * A seam rather than calling the client directly: the dashboard is the screen
 * where a wrong click removes somebody's access, so its behaviour is worth
 * testing without a server behind it.
 */
export interface DashboardApi {
  listMembers(): Promise<UserAccount[]>;
  setRole(userId: string, role: UserRole): Promise<UserAccount>;
  setSuspended(userId: string, suspended: boolean): Promise<UserAccount>;
  removeMember(userId: string): Promise<void>;
  listInvites(): Promise<Invite[]>;
  createInvite(input: { role: Exclude<UserRole, 'owner'>; label?: string }): Promise<Invite>;
  revokeInvite(inviteId: string): Promise<void>;
  status(): Promise<ServerStatus>;
  logs(): Promise<ServerLogEntry[]>;
  listAgents(): Promise<Agent[]>;
  listProviders(): Promise<ProviderConfigPublic[]>;
  listModels(providerId: string): Promise<ModelInfo[]>;
  removeProvider(providerId: string): Promise<void>;
}

export const serverApi: DashboardApi = {
  listMembers: () => client.users.list(),
  setRole: (userId, role) => client.users.setRole(userId, role),
  setSuspended: (userId, suspended) => client.users.setSuspended(userId, suspended),
  removeMember: (userId) => client.users.remove(userId),
  listInvites: async () => (await client.users.listInvites()).invites,
  createInvite: async (input) => (await client.users.createInvite(input)).invite,
  revokeInvite: (inviteId) => client.users.revokeInvite(inviteId),
  status: () => client.server.status(),
  logs: async () => (await client.server.logs()).entries,
  listAgents: () => client.agents.list(),
  listProviders: () => client.providers.list(),
  listModels: (providerId) => client.providers.listModels(providerId),
  removeProvider: (providerId) => client.providers.delete(providerId),
};
