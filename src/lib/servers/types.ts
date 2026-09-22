/**
 * One server an account can open, as Crewly Cloud describes it.
 *
 * Everything here is known before connecting, so the switcher can be drawn
 * without reaching a single server -- including servers that are still being
 * built, or that are not answering.
 */
export type RegistryServer = {
  id: string;
  kind: 'cloud' | 'self_hosted';
  name: string;
  /** Null while a cloud server has no address yet. */
  endpoint: string | null;
  status: 'pending' | 'provisioning' | 'ready' | 'suspended' | 'failed' | 'deleting' | 'deleted' | 'unknown';
  /** The role the account holds in the owning workspace; null for self-hosted. */
  role: 'owner' | 'admin' | 'member' | null;
  organizationId: string | null;
  reachable: boolean;
};

export type CloudAccountProfile = {
  id: string;
  email: string;
  displayName: string;
  isOperator: boolean;
};
