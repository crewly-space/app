// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrewlyApiError, type CrewlyConnection, type MailDelivery, type MailDomain, type MailOverview } from '@crewly/sdk';
import { CrewlyPanel } from '../src/features/dashboard/CrewlyPanel';
import { MailPanel } from '../src/features/dashboard/MailPanel';
import { SendingDomains } from '../src/features/dashboard/SendingDomains';
import type { ServicesApi } from '../src/features/dashboard/services-api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const disconnected: CrewlyConnection = {
  status: 'disconnected', cloudUrl: null, instanceId: null, scopes: [], credentialVersion: null, connectedAt: null, lastCheckedAt: null, link: null,
};
const pending: CrewlyConnection = {
  ...disconnected, status: 'pending', cloudUrl: 'https://app.crewly.space',
  link: { userCode: 'BCDF-GHJK', verificationUrl: 'https://app.crewly.space/#/connect/BCDF-GHJK', expiresAt: '2026-09-23T16:00:00.000Z', interval: 5 },
};
const connected: CrewlyConnection = {
  ...disconnected, status: 'connected', cloudUrl: 'https://app.crewly.space', instanceId: 'inst-1', scopes: ['mail:send'], credentialVersion: 1,
  connectedAt: '2026-09-23T15:00:00.000Z', lastCheckedAt: '2026-09-23T15:00:00.000Z',
};

const overview: MailOverview = {
  settings: { provider: 'disabled', fromAddress: null, config: {}, hasSecret: false, updatedAt: null },
  providers: ['disabled', 'crewly', 'smtp', 'resend', 'postmark'],
  crewlyMailAvailable: false,
  retryPolicy: { maxAttempts: 5, delaysMs: [60_000] },
};

const failedDelivery: MailDelivery = {
  id: 'd1', category: 'member.invited', recipient: 'new@example.com', subject: "You're invited to Crewly", provider: 'smtp',
  status: 'failed', attempts: 1, errorClass: 'auth', lastError: '535 bad credentials', providerMessageId: null, nextAttemptAt: null,
  createdAt: '2026-09-23T15:00:00.000Z', sentAt: null,
};

const pendingDomain: MailDomain = {
  id: 'dom-1', domain: 'acme.com', status: 'pending', failureReason: 'Not found yet: TXT resend._domainkey',
  records: [{ type: 'TXT', name: 'resend._domainkey.acme.com', value: 'p=MIGf', purpose: 'DKIM' }],
  senders: [{ localPart: 'crew', name: null }], lastCheckedAt: null, verifiedAt: null, createdAt: '2026-09-23T15:00:00.000Z',
};

function services(overrides: Partial<ServicesApi> = {}): ServicesApi {
  return {
    crewly: async () => disconnected,
    connectCrewly: vi.fn(async () => pending),
    pollCrewly: vi.fn(async () => connected),
    refreshCrewly: vi.fn(async () => connected),
    rotateCrewly: vi.fn(async () => ({ ...connected, credentialVersion: 2 })),
    disconnectCrewly: vi.fn(async () => {}),
    mail: async () => overview,
    updateMail: vi.fn(async (input) => ({ ...overview.settings, provider: input.provider, fromAddress: input.fromAddress ?? null, config: input.config ?? {}, hasSecret: Boolean(input.secret) })),
    testMail: vi.fn(async (to) => ({ ...failedDelivery, id: 'd2', recipient: to, status: 'sent' as const, errorClass: null, lastError: null })),
    deliveries: async () => [],
    retryDelivery: vi.fn(async () => ({ ...failedDelivery, status: 'sent' as const, lastError: null })),
    mailDomains: async () => [],
    addMailDomain: vi.fn(async (domain) => ({ ...pendingDomain, domain })),
    checkMailDomain: vi.fn(async () => ({ ...pendingDomain, status: 'verified' as const, failureReason: null })),
    setMailDomainSenders: vi.fn(async (_id, senders) => ({ ...pendingDomain, senders })),
    removeMailDomain: vi.fn(async () => {}),
    inboundMail: async () => [],
    ...overrides,
  };
}

describe('Connect Crewly panel', () => {
  it('asks for the chosen services, shows the code, and finishes on its own once approved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = services();
    render(<CrewlyPanel api={api} serverName="Acme production" />);
    fireEvent.click(await screen.findByLabelText('Run Crewly AI models'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Crewly' }));

    expect(await screen.findByLabelText('Link code')).toHaveProperty('textContent', 'BCDF-GHJK');
    expect(api.connectCrewly).toHaveBeenCalledWith({ name: 'Acme production', scopes: ['mail:send', 'inference'] });
    expect(screen.getByRole('link', { name: 'Open Crewly' }).getAttribute('href')).toBe('https://app.crewly.space/#/connect/BCDF-GHJK');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(await screen.findByText('Connected to Crewly.')).toBeTruthy();
    expect(screen.getByText('inst-1')).toBeTruthy();
  });

  it('rotates and disconnects a live connection', async () => {
    const api = services({ crewly: vi.fn(async () => connected) });
    render(<CrewlyPanel api={api} serverName="Acme" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate credential' }));
    expect(await screen.findByText('Version 2')).toBeTruthy();

    (api.crewly as ReturnType<typeof vi.fn>).mockResolvedValue(disconnected);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Not connected. This server runs entirely on its own.')).toBeTruthy();
    expect(api.disconnectCrewly).toHaveBeenCalled();
  });

  it('treats a stale cloud connection as disconnected and recoverable', async () => {
    const api = services({
      crewly: vi.fn(async () => { throw new CrewlyApiError('missing', 404, 'not_found'); }),
    });
    render(<CrewlyPanel api={api} serverName="Acme" />);

    expect(await screen.findByText('Not connected. This server runs entirely on its own.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Crewly' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Mail panel', () => {
  it('configures SMTP without echoing the password, then sends a test', async () => {
    const api = services();
    render(<MailPanel api={api} />);
    fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'smtp' } });
    fireEvent.change(screen.getByLabelText('From address'), { target: { value: 'crew@example.com' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'smtp.example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateMail).toHaveBeenCalledWith({
      provider: 'smtp',
      fromAddress: 'crew@example.com',
      config: { host: 'smtp.example.com', port: 587, security: 'starttls' },
      secret: 'hunter2',
    }));
    await waitFor(() => expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(''));
    expect(screen.getByLabelText('Password').getAttribute('placeholder')).toBe('Stored. Type to replace it');

    fireEvent.change(screen.getByLabelText('Send a test to'), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('me@example.com')).toBeTruthy();
  });

  it('shows why a delivery failed and retries it', async () => {
    const api = services({ deliveries: async () => [failedDelivery] });
    render(<MailPanel api={api} />);
    expect(await screen.findByText('535 bad credentials')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry email to new@example.com' }));
    await waitFor(() => expect(api.retryDelivery).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText('Sent')).toBeTruthy();
  });

  it('says what Crewly Mail still needs', async () => {
    render(<MailPanel api={services()} />);
    fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'crewly' } });
    expect(screen.getByText(/needs this server connected to Crewly/)).toBeTruthy();
  });

  it('explains incomplete SMTP settings before sending them to the server', async () => {
    const api = services();
    render(<MailPanel api={api} />);
    fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'smtp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A from address is required for this provider.')).toBeTruthy();
    expect(api.updateMail).not.toHaveBeenCalled();
  });

  it('adds a sending domain for Crewly Mail, shows its DNS records, and checks it', async () => {
    const crewlyOverview: MailOverview = { ...overview, settings: { ...overview.settings, provider: 'crewly' }, crewlyMailAvailable: true };
    const api = services({ mail: async () => crewlyOverview });
    render(<MailPanel api={api} />);
    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByText('resend._domainkey.acme.com')).toBeTruthy();
    expect(screen.getByText('Not found yet: TXT resend._domainkey')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Verified/)).toBeTruthy();
    expect(screen.queryByText('resend._domainkey.acme.com')).toBeNull();

    fireEvent.change(screen.getByLabelText('Senders on acme.com'), { target: { value: 'crew, support' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save senders' }));
    await waitFor(() => expect(api.setMailDomainSenders).toHaveBeenCalledWith('dom-1', [{ localPart: 'crew' }, { localPart: 'support' }]));
  });

  it('does not let an older domain request overwrite a domain that was just added', async () => {
    let finishOlderRequest!: (domains: MailDomain[]) => void;
    const olderApi = services({
      mailDomains: vi.fn(() => new Promise<MailDomain[]>((resolve) => { finishOlderRequest = resolve; })),
    });
    const currentApi = services();
    const view = render(<SendingDomains api={olderApi} />);
    await waitFor(() => expect(olderApi.mailDomains).toHaveBeenCalled());

    view.rerender(<SendingDomains api={currentApi} />);
    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'new.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByLabelText('Senders on new.example')).toBeTruthy();

    await act(async () => { finishOlderRequest([{ ...pendingDomain, domain: 'stale.example' }]); });
    expect(screen.getByLabelText('Senders on new.example')).toBeTruthy();
    expect(screen.queryByText(/stale\.example/)).toBeNull();
  });

  it('shows incoming email and why any was not posted', async () => {
    const api = services({
      inboundMail: async () => [{
        id: 'in-1', kind: 'reply', sender: 'mallory@evil.test', recipient: 'reply+k.t@inbound.crewly.test', status: 'rejected',
        reason: 'sender_mismatch', conversationId: null, messageId: null, receivedAt: '2026-09-23T15:00:00.000Z', processedAt: '2026-09-23T15:00:01.000Z',
      }],
    });
    render(<MailPanel api={api} />);
    expect(await screen.findByText('Not posted: sent from a different address than the one it was addressed to')).toBeTruthy();
  });
});
