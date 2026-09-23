import { useCallback, useState } from 'react';
import { activeServerId } from '../../lib/api/client';

/**
 * First run, as one flow: connect a provider, create a first agent, or skip
 * either and land somewhere useful.
 *
 * Where someone is in it comes from the server, not from a wizard's memory:
 * a connected provider is the provider step done, an agent is the whole flow
 * done. The only thing kept here is what the server cannot know -- that this
 * person chose to skip a step -- and that is kept per server, so a refresh
 * resumes and another server starts fresh.
 */
export type FirstRunStep = 'provider' | 'agent' | 'home';

export type FirstRunSkips = { provider?: boolean; agent?: boolean };

export function firstRunStep(state: {
  hasConnectedProvider: boolean;
  /** Only owners and admins can connect a provider. */
  canManageProviders: boolean;
  skipped: FirstRunSkips;
}): FirstRunStep {
  if (!state.hasConnectedProvider) {
    return state.canManageProviders && !state.skipped.provider ? 'provider' : 'home';
  }
  return state.skipped.agent ? 'home' : 'agent';
}

const storageKey = () => `crewly:first-run:${activeServerId() ?? 'local'}`;

function readSkips(): FirstRunSkips {
  try {
    const raw = localStorage.getItem(storageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as FirstRunSkips) : {};
  } catch {
    // Storage refused or garbled: every step is simply offered again.
    return {};
  }
}

function writeSkips(skips: FirstRunSkips): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(skips));
  } catch { /* the skip holds until the page is reloaded */ }
}

/** The skips for the open server, and ways to change them that survive a reload. */
export function useFirstRunSkips() {
  const [skipped, setSkipped] = useState<FirstRunSkips>(readSkips);
  const update = useCallback((change: FirstRunSkips) => {
    setSkipped((current) => {
      const next = { ...current, ...change };
      writeSkips(next);
      return next;
    });
  }, []);
  return {
    skipped,
    skip: (step: 'provider' | 'agent') => update({ [step]: true }),
    resume: (step: 'provider' | 'agent') => update({ [step]: false }),
  };
}

/**
 * Where a skipped first run lands: the server, empty, with the next useful
 * thing one click away. Never a dead end -- settings and sign-out are always
 * here, and nothing on it depends on a provider being connected.
 */
export function FirstRunHome({
  hasConnectedProvider,
  canManageProviders,
  onConnectProvider,
  onCreateAgent,
  onOpenSettings,
}: {
  hasConnectedProvider: boolean;
  canManageProviders: boolean;
  onConnectProvider: () => void;
  onCreateAgent: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="onboarding-body">
      <div className="onboarding-card form first-run-home">
        <h1>Your server is ready</h1>
        {hasConnectedProvider ? (
          <>
            <p>There are no agents here yet. Create one to start a conversation.</p>
            <button className="primary-button" type="button" onClick={onCreateAgent}>Create an agent</button>
          </>
        ) : canManageProviders ? (
          <>
            <p>Agents need a model provider to think with. Connect one to create your first agent.</p>
            <button className="primary-button" type="button" onClick={onConnectProvider}>Connect provider</button>
          </>
        ) : (
          <p>Agents need a model provider, and only an owner or admin of this server can connect one. Ask them, then come back.</p>
        )}
        <button className="text-button" type="button" onClick={onOpenSettings}>Open settings</button>
      </div>
    </div>
  );
}
