// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ViewErrorBoundary } from '../src/features/errors/ViewErrorBoundary';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('recovers an optional view without removing the rest of the workspace', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let broken = true;
  function Panel() { if (broken) throw new Error('Bad panel data'); return <p>Panel recovered</p>; }
  render(<><p>Conversation stays open</p><ViewErrorBoundary resetKey="one"><Panel /></ViewErrorBoundary></>);
  expect(screen.getByText('Conversation stays open')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  broken = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Panel recovered')).toBeTruthy();
});
