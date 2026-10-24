import { useCallback, useEffect, useRef } from 'react';

/** A response belongs to the view that started it, even when React reuses it. */
export function useRequestScope(key: string) {
  const current = useRef({ key, revision: 0, mounted: false });
  if (current.current.key !== key) {
    current.current.key = key;
    current.current.revision += 1;
  }
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; current.current.revision += 1; };
  }, []);
  return useCallback(() => {
    const revision = current.current.revision;
    return () => current.current.mounted && current.current.revision === revision;
  }, []);
}
