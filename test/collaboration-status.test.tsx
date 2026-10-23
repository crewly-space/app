// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentWorkEvent } from '../src/lib/realtime/events';
import { CollaborationStatus } from '../src/features/conversations/CollaborationStatus';
const listeners = vi.hoisted(() => new Set<(event: AgentWorkEvent) => void>());
vi.mock('../src/lib/realtime/events', () => ({ onAgentWorkChanged: (listener: (event: AgentWorkEvent) => void) => {
  listeners.add(listener); return () => listeners.delete(listener);
} }));
const emit = (event: AgentWorkEvent) => act(() => { for (const listener of listeners) listener(event); });
const start: AgentWorkEvent = { type: 'consultation', conversationId: 'room', parentRunId: 'run', fromAgentId: 'lead', toAgentId: 'helper', status: 'started' };
const agents = [{ id: 'lead', name: 'Lead' }, { id: 'helper', name: 'Researcher' }];
afterEach(cleanup);
it('shows who is consulting whom only in the relevant conversation and clears completed work', () => {
  render(<CollaborationStatus conversationId="room" agents={agents} />);
  emit({ ...start, conversationId: 'elsewhere' }); expect(screen.queryByRole('status')).toBeNull();
  emit(start); emit(start);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByText('Lead is consulting Researcher…')).toBeTruthy();
  emit({ ...start, status: 'completed' }); expect(screen.queryByRole('status')).toBeNull();
  emit(start); emit({ type: 'finished', runId: 'run' }); expect(screen.queryByRole('status')).toBeNull();
});
it('clears stale consultations on disconnect, switching conversation and unmount', () => {
  const view = render(<CollaborationStatus conversationId="room" agents={agents} />);
  emit(start); emit({ type: 'reset' }); expect(screen.queryByRole('status')).toBeNull();
  emit(start); view.rerender(<CollaborationStatus conversationId="another" agents={agents} />);
  expect(screen.queryByRole('status')).toBeNull();
  view.unmount(); expect(listeners.size).toBe(0);
});
