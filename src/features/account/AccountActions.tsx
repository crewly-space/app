import { useState } from 'react';
import { LayoutDashboard, LogOut } from 'lucide-react';
import { logout } from '../../lib/logout';

export function AccountActions({ dashboardUrl, compact = false }: { dashboardUrl?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className={`account-actions${compact ? ' compact' : ''}`}>
    {dashboardUrl && <a href={dashboardUrl} title="Workspaces, servers and billing"><LayoutDashboard size={17} /><span>Dashboard</span></a>}
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      setError('');
      try { await logout(); }
      catch { setError('Could not log out. Try again.'); }
      finally { setBusy(false); }
    }}><LogOut size={17} /><span>{busy ? 'Logging out…' : 'Log out'}</span></button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
