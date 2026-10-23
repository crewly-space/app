// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../src/features/errors/AppErrorBoundary';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps a crashing screen recoverable and retains the saved session', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('crewly:session', 'existing-session');
  function Broken(): never { throw new Error('render failed'); }
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
  expect(screen.getByRole('heading', { name: 'Let’s reopen your workspace' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reload Crewly' })).toBeTruthy();
  expect(localStorage.getItem('crewly:session')).toBe('existing-session');
  localStorage.clear();
});
