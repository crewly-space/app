// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRail } from '../src/features/servers/ServerRail';
import { activateServer, activeServerId, client, currentToken } from '../src/lib/api/client';
import { clientFor, storeServerToken } from '../src/lib/servers/session';
import type { RegistryServer } from '../src/lib/servers/types';

const cloud: RegistryServer = {
  id: 'dep-1', kind: 'cloud', name: 'Acme production',
  endpoint: 'https://production.acme.servers.crewly.space',
  status: 'ready', role: 'owner', organizationId: 'org-1', reachable: true,
};
const building: RegistryServer = {
  ...cloud, id: 'dep-2', name: 'Second', status: 'provisioning', reachable: false, endpoint: null,
};
const selfHosted: RegistryServer = {
  id: 'own-1', kind: 'self_hosted', name: 'Home lab', endpoint: 'https://crewly.example.com',
  status: 'unknown', role: null, organizationId: null, reachable: true,
};

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function rail(overrides: Partial<Parameters<typeof ServerRail>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <ServerRail
      servers={[cloud, selfHosted]}
      selectedId={cloud.id}
      onSelect={onSelect}
      onAddServer={vi.fn()}
      {...overrides}
    />,
  );
  return onSelect;
}

describe('the server rail', () => {
  it('lists every server on the account', () => {
    rail();
    expect(screen.getByRole('tab', { name: /Acme production/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Home lab/ })).toBeTruthy();
  });

  it('says which kind each server is, without a separate app for each', () => {
    rail();
    // Said in words rather than colour alone, so it survives a screen reader.
    expect(screen.getByRole('tab', { name: /Acme production/ }).getAttribute('aria-label'))
      .toMatch(/cloud/i);
    expect(screen.getByRole('tab', { name: /Home lab/ }).getAttribute('aria-label'))
      .toMatch(/self-hosted/i);
  });

  it('marks the server being looked at', () => {
    rail();
    expect(screen.getByRole('tab', { name: /Acme production/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Home lab/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('reports a server that is still being built instead of offering it', () => {
    const onSelect = rail({ servers: [cloud, building], selectedId: cloud.id });
    const tab = screen.getByRole('tab', { name: /Second/ });
    expect(tab.getAttribute('aria-label')).toMatch(/provisioning/i);
    fireEvent.click(tab);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows how many messages are waiting on a server nobody is looking at', () => {
    rail({ unread: { [selfHosted.id]: 4 } });
    expect(screen.getByRole('tab', { name: /Home lab/ }).textContent).toContain('4');
    // Never on the one being read: those messages are not waiting.
    expect(screen.getByRole('tab', { name: /Acme production/ }).textContent).not.toContain('4');
  });

  it('says when a server could not be reached, rather than looking idle', () => {
    rail({ failures: { [selfHosted.id]: 'Could not reach this server' } });
    const tab = screen.getByRole('tab', { name: /Home lab/ });
    expect(tab.getAttribute('aria-label')).toMatch(/could not reach/i);
  });

  it('switches on a click', () => {
    const onSelect = rail();
    fireEvent.click(screen.getByRole('tab', { name: /Home lab/ }));
    expect(onSelect).toHaveBeenCalledWith(selfHosted);
  });

  it('offers adding a server of your own', () => {
    const onAddServer = vi.fn();
    rail({ onAddServer });
    fireEvent.click(screen.getByRole('button', { name: /add a server/i }));
    expect(onAddServer).toHaveBeenCalled();
  });
});

describe('switching the server the app talks to', () => {
  it('points the shared client at the chosen server and keeps every session', () => {
    storeServerToken(cloud.id, 'cloud-token');
    storeServerToken(selfHosted.id, 'home-token');

    activateServer(cloud);
    expect(activeServerId()).toBe(cloud.id);
    expect(currentToken()).toBe('cloud-token');

    activateServer(selfHosted);
    expect(activeServerId()).toBe(selfHosted.id);
    expect(currentToken()).toBe('home-token');
    // Switching is not signing out: the other server's session is untouched.
    expect(localStorage.getItem(`crewly:session:${cloud.id}`)).toBe('cloud-token');
  });

  it('makes the shared import follow the switch, without anyone re-importing it', () => {
    activateServer(cloud);
    expect(client.auth).toBe(clientFor(cloud).client.auth);

    activateServer(selfHosted);
    // Same binding every module holds; what it points at is what changed.
    expect(client.auth).toBe(clientFor(selfHosted).client.auth);
    expect(client.auth).not.toBe(clientFor(cloud).client.auth);
  });
});
