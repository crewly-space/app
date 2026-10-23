import { useCallback, useEffect, useRef, useState } from 'react';

/** Busy and error state for a panel whose actions the server may refuse, and say why. */
export function useWork() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (!mounted.current) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'That did not work');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
