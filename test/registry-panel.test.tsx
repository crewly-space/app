// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegistryInstallation, RegistryItem } from '@crewly/sdk';
import type { PlatformApi } from '../src/features/dashboard/platform-api';
import { RegistryPanel } from '../src/features/dashboard/RegistryPanel';

afterEach(cleanup);

const github: RegistryItem = {
  id: 'crewly/github', type: 'mcp_preset', name: 'GitHub', description: 'Repositories and pull requests', publisher: 'Crewly',
  verified: true, compatibility: '*', requiredCapabilities: ['network.access'], requiredSecrets: ['GITHUB_TOKEN'], versions: [{ version: '1' }],
};
const review: RegistryItem = { ...github, id: 'crewly/pull-request-review', type: 'skill', name: 'Pull request review', requiredSecrets: [] };

function api(items: () => Promise<RegistryItem[]>, overrides: Partial<PlatformApi> = {}): PlatformApi {
  let installed: RegistryInstallation[] = [];
  return {
    registrySettings: async () => ({ enabled: false, registryUrl: null, allowUnverified: false }),
    registryItems: items,
    registryInstallations: async () => installed,
    installRegistryItem: vi.fn(async (input: { itemId: string }) => {
      const entry = { id: 'i1', itemType: 'mcp_preset', registryId: input.itemId, name: 'GitHub', publisher: 'Crewly', version: '1', pinnedVersion: null, verified: true } as unknown as RegistryInstallation;
      installed = [entry];
      return entry;
    }),
    ...overrides,
  } as unknown as PlatformApi;
}

describe('RegistryPanel', () => {
  it('offers the built-in catalog with no registry configured, and says what an installed tool still needs', async () => {
    const platform = api(async () => [github, review]);
    render(<RegistryPanel api={platform} type="mcp_preset" />);
    expect(await screen.findByText('GitHub')).toBeTruthy();
    // MCP servers are offered under MCP tools; skills stay under Skills.
    expect(screen.queryByText('Pull request review')).toBeNull();
    expect(screen.getByText(/needs secret GITHUB_TOKEN/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    expect(await screen.findByText(/Add the secret GITHUB_TOKEN in Secrets and grant it to GitHub/)).toBeTruthy();
    expect(platform.installRegistryItem).toHaveBeenCalledWith({ itemId: 'crewly/github', type: 'mcp_preset', version: '1' });
    expect(await screen.findByRole('button', { name: 'Added' })).toBeTruthy();
  });

  it('stays quiet on a server without the catalog while no registry is enabled', async () => {
    render(<RegistryPanel api={api(async () => { throw new Error('registry_disabled'); })} type="skill" showSource />);
    expect(await screen.findByText('Nothing to add yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Another registry')).toBeTruthy();
  });

  it('asks the server only for the kind of item its section adds', async () => {
    const registryItems = vi.fn(async () => [review]);
    render(<RegistryPanel api={api(registryItems)} type="skill" />);
    expect(await screen.findByText('Pull request review')).toBeTruthy();
    expect(registryItems).toHaveBeenCalledWith({ q: '', type: 'skill' });
    expect(screen.queryByText('Another registry')).toBeNull();
  });
});
