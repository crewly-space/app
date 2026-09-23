// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentEditor } from '../src/features/agents/AgentEditor';
import type { ModelInfo } from '../src/protocol';

type Providers = Parameters<typeof AgentEditor>[0]['providers'];

const connected = { id: 'claude-1', name: 'claude-subscription', detail: 'Paired device connected', status: 'connected', local: true };
const missing = { id: 'openai-1', name: 'openai', detail: 'No API key', status: 'missing', local: false };

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value() {} });
});

afterEach(cleanup);

async function openEditor(providers: Providers, models: ModelInfo[] = []) {
  const onSubmit = vi.fn(async () => {});
  render(
    <AgentEditor
      providers={providers}
      onClose={() => {}}
      onSubmit={onSubmit}
      // No provider behind these tests, so the picker falls back to a typed id.
      loadModels={async () => models}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: 'Echo' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Role/ }), { target: { value: 'Assistant' } });
  // Without a connected provider there is no model to choose; the editor says
  // so before it asks for one.
  if (providers.some((provider) => provider.status === 'connected')) {
    fireEvent.change(await screen.findByRole('textbox', { name: /Model ID/ }), {
      target: { value: 'test-model' },
    });
  }
  return onSubmit;
}

const createButton = () => screen.getByRole('button', { name: /Create agent/ });

describe('AgentEditor without a usable provider', () => {
  it('tells the user to connect a provider instead of ignoring the click', async () => {
    const onSubmit = await openEditor([]);

    fireEvent.click(createButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/connect a provider/i);
  });

  it('says the same when the only provider is not connected', async () => {
    const onSubmit = await openEditor([missing]);

    fireEvent.click(createButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/connect a provider/i);
  });

  it('warns before submitting, so the empty provider list is not a surprise', async () => {
    await openEditor([]);

    expect(screen.getByText(/no connected provider/i)).toBeTruthy();
  });
});

describe('AgentEditor with a connected provider', () => {
  it('defaults to a connected provider, not to the first provider in the list', async () => {
    const onSubmit = await openEditor([missing, connected]);

    fireEvent.click(createButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ providerId: 'claude-1', model: 'test-model' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AgentEditor when a provider connects while it is open', () => {
  it('adopts the provider and offers its models', async () => {
    const props = { onClose: () => {}, onSubmit: async () => {}, loadModels: async () => [] };
    const view = render(<AgentEditor providers={[]} {...props} />);
    expect(screen.queryByRole('textbox', { name: /Model ID/ })).toBeNull();

    view.rerender(<AgentEditor providers={[connected as Providers[number]]} {...props} />);
    expect(await screen.findByRole('textbox', { name: /Model ID/ })).toBeTruthy();
  });
});
