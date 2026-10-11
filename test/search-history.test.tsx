// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchDialog } from '../src/features/search/SearchDialog';
import { gateway } from '../src/lib/gateway';

vi.mock('../src/lib/gateway', () => ({ gateway: { searchMessages: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const conversations = [{ id: 'general', type: 'channel' as const, name: 'general', agentIds: [], preview: '', time: '' }];
it('finds older stored messages absent from the loaded workspace and shows their text', async () => {
  vi.mocked(gateway.searchMessages).mockResolvedValue([{ id: 'old', conversationId: 'general', author: 'you', body: 'Last year we planned the launch', time: '', attachments: [] }]);
  const onSelect = vi.fn();
  render(<SearchDialog agents={[]} conversations={conversations} messages={[]} onClose={vi.fn()} onSelect={onSelect} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'launch' } });
  expect(await screen.findByText('Last year we planned the launch')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /general/ }));
  expect(onSelect).toHaveBeenCalledWith('general', expect.objectContaining({ id: 'old' }));
});
it('reports unavailable history instead of claiming no messages exist', async () => {
  vi.mocked(gateway.searchMessages).mockRejectedValue(new Error('Server is offline'));
  render(<SearchDialog agents={[]} conversations={conversations} messages={[]} onClose={vi.fn()} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'launch' } });
  expect((await screen.findByRole('alert')).textContent).toBe('Server is offline');
  expect(screen.queryByText('No conversations found')).toBeNull();
});
