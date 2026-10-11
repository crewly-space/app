// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Automation } from '@crewly/sdk';
import { AutomationsPanel } from '../src/features/dashboard/AutomationsPanel';

afterEach(cleanup);
const rule: Automation = {
  id: 'rule', name: 'Launch notice', description: '', enabled: true, triggerType: 'message', triggerConfig: {}, conditions: {},
  actions: [{ type: 'post_message', conversationId: 'general', body: 'Original message' }, { type: 'call_webhook', url: 'https://example.com/hook', body: { keep: true } }],
  createdBy: 'owner', createdAt: '', updatedAt: '',
};
const targets = [{ id: 'general', name: '#general' }];

it('edits saved rules and preserves every action and webhook payload', async () => {
  const onUpdate = vi.fn(async (_id, input) => ({ ...rule, ...input }));
  render(<AutomationsPanel automations={[rule]} runs={[]} busy={false} targets={targets} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited notice' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('rule', expect.objectContaining({ name: 'Edited notice', actions: [
    { type: 'post_message', conversationId: 'general', body: 'Edited message' }, rule.actions[1],
  ] })));
});

it('shows save errors and lets the user retry with their draft intact', async () => {
  const onUpdate = vi.fn().mockRejectedValueOnce(new Error('Server is offline')).mockResolvedValue(rule);
  render(<AutomationsPanel automations={[rule]} runs={[]} busy={false} targets={targets} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keep my draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Server is offline');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Keep my draft');
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
});

it('edits an agent action without replacing it with a message action', async () => {
  const agentRule: Automation = { ...rule, actions: [{ type: 'invoke_agent', agentId: 'helper', conversationId: 'general', prompt: 'Plan' }] };
  const onUpdate = vi.fn(async (_id, input) => ({ ...agentRule, ...input }));
  render(<AutomationsPanel automations={[agentRule]} agents={[{ id: 'helper', name: 'Helper' }]} runs={[]} busy={false} targets={targets} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Plan the launch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('rule', expect.objectContaining({ actions: [{ type: 'invoke_agent', agentId: 'helper', conversationId: 'general', prompt: 'Plan the launch' }] })));
});

it('uses the displayed schedule interval and retains the created draft until the refreshed list arrives', async () => {
  const onCreate = vi.fn(async (input) => ({ automation: { ...rule, ...input, id: 'new-rule' }, webhookSecret: 'copy-once-secret' }));
  const props = { automations: [] as Automation[], runs: [], busy: false, targets, onCreate, onUpdate: vi.fn(), onDelete: vi.fn() };
  const view = render(<AutomationsPanel {...props} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hourly notice' } });
  fireEvent.change(screen.getByLabelText('Trigger'), { target: { value: 'schedule' } });
  fireEvent.change(screen.getByLabelText('Conversation'), { target: { value: 'general' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hourly update' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await screen.findByText('copy-once-secret');
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ triggerType: 'schedule', triggerConfig: { intervalMinutes: 60 } }));
  view.rerender(<AutomationsPanel {...props} automations={[]} />);
  expect(screen.getByText('copy-once-secret')).toBeTruthy();
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Hourly update');
});
