import type { CrewlyConnection, MailDelivery, MailOverview, MailSettings, MailSettingsInput } from '@crewly/sdk';
import { client } from '../../lib/api/client';

/**
 * The server's connection to Crewly and its outbound mail, behind one seam so
 * both panels can be tested without a server.
 */
export interface ServicesApi {
  crewly(): Promise<CrewlyConnection>;
  connectCrewly(input: { name?: string; scopes?: string[] }): Promise<CrewlyConnection>;
  pollCrewly(): Promise<CrewlyConnection>;
  refreshCrewly(): Promise<CrewlyConnection>;
  rotateCrewly(): Promise<CrewlyConnection>;
  disconnectCrewly(): Promise<void>;

  mail(): Promise<MailOverview>;
  updateMail(input: MailSettingsInput): Promise<MailSettings>;
  testMail(to: string): Promise<MailDelivery>;
  deliveries(): Promise<MailDelivery[]>;
  retryDelivery(id: string): Promise<MailDelivery>;
}

export const servicesApi: ServicesApi = {
  crewly: () => client.crewly.get(),
  connectCrewly: (input) => client.crewly.connect(input),
  pollCrewly: () => client.crewly.poll(),
  refreshCrewly: () => client.crewly.refresh(),
  rotateCrewly: () => client.crewly.rotate(),
  disconnectCrewly: async () => { await client.crewly.disconnect(); },

  mail: () => client.mail.get(),
  updateMail: async (input) => (await client.mail.update(input)).settings,
  testMail: async (to) => (await client.mail.test(to)).delivery,
  deliveries: async () => (await client.mail.deliveries({ limit: 50 })).deliveries,
  retryDelivery: async (id) => (await client.mail.retry(id)).delivery,
};
