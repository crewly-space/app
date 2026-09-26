import { useEffect, useState, type ReactNode } from 'react';
import { AuthGate } from '../auth/AuthGate';
import { AddServerDialog } from './AddServerDialog';
import { ServerRail } from './ServerRail';
import { AccountProfileDialog } from '../account/AccountProfileDialog';
import type { ServerRegistry } from './useServerRegistry';

const dashboardUrl: string | undefined = import.meta.env.VITE_CREWLY_DASHBOARD_URL;

/**
 * The hosted app while the selected server is not open yet.
 *
 * The account is signed in, so the rail is always here: whatever one server
 * is doing -- being built, offline, wanting its own login -- is said beside
 * it, and every other server stays one click away. Nothing here asks a
 * visitor to start a server; on app.crewly.space they do not run one.
 */
export function ServerPending({ registry }: { registry: ServerRegistry }) {
  const [adding, setAdding] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [slow, setSlow] = useState(false);
  const { selected, connection } = registry;
  const refresh = () => void registry.refresh().catch(() => {});

  useEffect(() => {
    const waiting = connection.state === 'loading' || connection.state === 'connecting';
    setSlow(false);
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [connection.state, selected?.id]);

  let body: ReactNode;
  switch (connection.state) {
    case 'cloud_unreachable':
      body = <div className="onboarding-card form">
        <h1>Can't load your servers</h1>
        <p role="alert">Crewly is not answering, so this page could not list your servers. They are not affected.</p>
        <button className="primary-button" type="button" onClick={refresh}>Try again</button>
      </div>;
      break;
    case 'no_servers':
      body = <div className="onboarding-card form">
        <h1>No servers yet</h1>
        <p>Your crew lives on a server. Create one on Crewly Cloud, or add one you run yourself.</p>
        {dashboardUrl && <a className="primary-button" href={dashboardUrl}>Create a server</a>}
        <button className={dashboardUrl ? 'text-button' : 'primary-button'} type="button" onClick={() => setAdding(true)}>Add a self-hosted server</button>
        <button className="text-button" type="button" onClick={refresh}>I've created one</button>
      </div>;
      break;
    case 'not_ready':
      body = <div className="onboarding-card form">
        <h1>{selected?.name} isn't ready</h1>
        <p>This server is {connection.status}. A new server usually takes under a minute.</p>
        <button className="primary-button" type="button" onClick={refresh}>Check again</button>
        {dashboardUrl && <a className="text-button" href={dashboardUrl}>Open the dashboard</a>}
      </div>;
      break;
    case 'unreachable':
      body = <div className="onboarding-card form">
        <h1>{selected?.name} isn't answering</h1>
        <p role="alert">Couldn't reach this server. It may be offline or restarting; your other servers still work.</p>
        <button className="primary-button" type="button" onClick={registry.reconnect}>Try again</button>
      </div>;
      break;
    case 'needs_login':
      // The server's own login, scoped to it. Keyed by server so switching
      // away and back starts a fresh form rather than another server's.
      body = <AuthGate key={selected?.id} server={selected?.name ?? 'this server'} onReady={registry.reconnect} />;
      break;
    default:
      body = <div className="server-pending-body">
        <div className="server-switch-skeleton boot-skeleton" role="status" aria-live="polite">
          <div className="server-switch-skeleton-mark"><span /><span /><span /></div>
          <div className="server-switch-skeleton-lines"><i /><i /><i /></div>
          <p className="server-pending-status">{selected ? `Opening ${selected.name}…` : 'Loading your servers…'}</p>
          {slow && <div className="server-pending-retry">
            <p>{selected ? 'This server is taking longer than expected.' : 'Crewly is taking longer than expected.'}</p>
            <button className="secondary-button" type="button" onClick={selected ? registry.reconnect : refresh}>Try again</button>
          </div>}
        </div>
      </div>;
  }

  return <div className="app-shell server-pending">
    <ServerRail
      servers={registry.servers}
      selectedId={selected?.id ?? null}
      onSelect={registry.select}
      onAddServer={() => setAdding(true)}
      dashboardUrl={dashboardUrl}
      unread={registry.unread}
      failures={registry.failures}
      account={registry.account}
      onProfile={() => setProfileOpen(true)}
    />
    <main className="server-pending-main">
      {connection.state === 'needs_login' || connection.state === 'loading' || connection.state === 'connecting'
        ? body
        : <div className="server-pending-body">{body}</div>}
    </main>
    {adding && (
      <AddServerDialog
        onClose={() => setAdding(false)}
        onAdded={() => { setAdding(false); refresh(); }}
      />
    )}
    {profileOpen && registry.account && registry.accountClient && (
      <AccountProfileDialog
        account={registry.account}
        cloud={registry.accountClient}
        onClose={() => setProfileOpen(false)}
        onSaved={() => { setProfileOpen(false); refresh(); }}
      />
    )}
  </div>;
}
