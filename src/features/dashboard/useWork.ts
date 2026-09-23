import { useCallback, useState } from 'react';

/** Busy and error state for a panel whose actions the server may refuse, and say why. */
export function useWork() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
