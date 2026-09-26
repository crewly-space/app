// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Avatar, UserAvatar } from '../src/features/appearance/Avatar';
import { AgentEditor } from '../src/features/agents/AgentEditor';
import type { Agent } from '../src/types';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});
afterEach(cleanup);

const agent: Agent = {
  id: 'a1', name: 'Maya', initials: 'M', role: 'Strategist', color: '#7857d8', status: 'online',
  model: 'm', providerId: 'p', runtime: 'Chat', memory: [],
};

describe('each identity is drawn in its own mode', () => {
  it('draws an agent as its owner chose, whoever is looking', () => {
    const { container, rerender } = render(<Avatar agent={{ ...agent, avatarMode: 'bloop' }} />);
    expect(container.querySelector('.bloop-agent')).toBeTruthy();

    rerender(<Avatar agent={{ ...agent, avatarMode: 'name' }} />);
    expect(container.querySelector('.bloop')).toBeNull();
    expect(container.textContent).toContain('M');
  });

  it('draws a person in their mode, never with the agent antenna', () => {
    const { container, rerender } = render(<UserAvatar id="u1" name="Sam" mode="bloop" />);
    expect(container.querySelector('.bloop-user')).toBeTruthy();
    expect(container.querySelector('.bloop-antenna')).toBeNull();

    rerender(<UserAvatar id="u1" name="Sam" mode="name" />);
    expect(container.textContent).toBe('S');
  });
});

describe('choosing an agent avatar', () => {
  it('saves the chosen mode with the agent', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<AgentEditor
      providers={[{ id: 'p', name: 'openai', detail: '', status: 'connected' }]}
      onClose={() => {}} onSubmit={onSubmit} loadModels={async () => []} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Echo' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Role/ }), { target: { value: 'Helper' } });
    fireEvent.change(await screen.findByRole('textbox', { name: /Model ID/ }), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('radio', { name: /Name icon/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create agent/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ avatarMode: 'name' });
  });

  it('keeps an existing agent’s mode selected when editing', () => {
    render(<AgentEditor agent={{ ...agent, avatarMode: 'blobatar' }}
      providers={[{ id: 'p', name: 'openai', detail: '', status: 'connected' }]}
      onClose={() => {}} onSubmit={async () => {}} loadModels={async () => []} />);
    expect((screen.getByRole('radio', { name: /Blobatar/ }) as HTMLInputElement).checked).toBe(true);
  });
});
