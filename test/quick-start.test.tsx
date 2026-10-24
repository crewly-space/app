// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickStart } from '../src/features/onboarding/QuickStart';
import { gateway } from '../src/lib/gateway';
import { client } from '../src/lib/api/client';
import type { Agent } from '../src/types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('retries opening a failed DM without creating a second assistant', async () => {
  const agent = { id: 'helper', name: 'Assistant' } as Agent;
  vi.spyOn(client.providers, 'listModels').mockResolvedValue([{ id: 'local', displayName: 'Local', contextWindow: 32000 }]);
  const create = vi.spyOn(gateway, 'createAgent').mockResolvedValue(agent);
  const dm = { id: 'dm1', name: 'Assistant', type: 'dm' as const, agentIds: ['helper'], preview: '', time: '' };
  const open = vi.spyOn(gateway, 'createDm').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(dm);
  const ready = vi.fn();
  render(<QuickStart providers={[{ id: 'p', name: 'Local', status: 'connected', detail: '' }]}
    onReady={ready} onSkip={vi.fn()} onSettings={vi.fn()} onRefresh={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Start chatting' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByLabelText(/Writing and publishing/));
  fireEvent.click(screen.getByRole('button', { name: 'Start chatting' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Retry opening chat' }));
  await waitFor(() => expect(ready).toHaveBeenCalledWith(agent, dm));
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ role: 'Writing partner', instructions: expect.stringContaining('usable drafts') }));
  expect(open).toHaveBeenCalledTimes(2);
});
