// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from '../src/features/agents/ModelPicker';

const models = [
  { id: 'claude-opus-5', providerId: 'anthropic-1', displayName: 'Claude Opus 5', contextWindow: 200_000 },
  { id: 'claude-haiku-4-5-20251001', providerId: 'anthropic-1', displayName: 'Claude Haiku 4.5', contextWindow: 200_000 },
  { id: 'gpt-4o-mini', providerId: 'anthropic-1', displayName: 'GPT-4o mini', contextWindow: 128_000 },
];

afterEach(cleanup);

function picker(overrides: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ModelPicker
      providerId="anthropic-1"
      value=""
      onChange={onChange}
      loadModels={async () => models}
      {...overrides}
    />,
  );
  return onChange;
}

describe('choosing a model', () => {
  it('lists what the provider actually offers', async () => {
    picker();
    expect(await screen.findByRole('option', { name: /Claude Opus 5/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /GPT-4o mini/ })).toBeTruthy();
  });

  it('shows the context window, which is what people choose between', async () => {
    picker();
    const option = await screen.findByRole('option', { name: /Claude Opus 5/ });
    expect(option.textContent).toMatch(/200K context/i);
  });

  it('filters the list as you search', async () => {
    picker();
    await screen.findByRole('option', { name: /Claude Opus 5/ });

    fireEvent.change(screen.getByRole('searchbox', { name: /search models/i }), { target: { value: 'haiku' } });

    expect(screen.queryByRole('option', { name: /Claude Opus 5/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Claude Haiku/ })).toBeTruthy();
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    picker();
    await screen.findByRole('option', { name: /Claude Opus 5/ });
    fireEvent.change(screen.getByRole('searchbox', { name: /search models/i }), { target: { value: 'llama' } });
    expect(screen.getByText(/no model matches/i)).toBeTruthy();
  });

  it('reports the chosen model by its id', async () => {
    const onChange = picker();
    fireEvent.click(await screen.findByRole('option', { name: /Claude Haiku/ }));
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
  });

  it('reloads when the provider changes', async () => {
    const loadModels = vi.fn(async () => models);
    const { rerender } = render(
      <ModelPicker providerId="anthropic-1" value="" onChange={vi.fn()} loadModels={loadModels} />,
    );
    await waitFor(() => expect(loadModels).toHaveBeenCalledWith('anthropic-1'));
    rerender(<ModelPicker providerId="openai-1" value="" onChange={vi.fn()} loadModels={loadModels} />);
    await waitFor(() => expect(loadModels).toHaveBeenCalledWith('openai-1'));
  });
});

describe('when the list cannot be had', () => {
  it('explains why, offers a retry, and only then a typed id on purpose', async () => {
    const onChange = picker({ loadModels: async () => { throw new Error('The provider could not be reached.'); } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be reached/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // A failed list is not an invitation to type: the raw field waits for a choice.
    expect(screen.queryByRole('textbox', { name: /model id/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /enter a model id instead/i }));
    const field = screen.getByRole('textbox', { name: /model id/i });
    fireEvent.change(field, { target: { value: 'some-new-model' } });
    expect(onChange).toHaveBeenCalledWith('some-new-model');
  });

  it('asks again when Retry is pressed, and shows the list that comes back', async () => {
    let calls = 0;
    const loadModels = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('Rate limited.'), { code: 'provider_rate_limited', body: { retryable: true } });
      return models;
    });
    picker({ loadModels });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: /Claude Opus 5/ })).toBeTruthy();
    expect(loadModels).toHaveBeenCalledTimes(2);
  });

  it('does not offer a retry that cannot help', async () => {
    picker({ loadModels: async () => {
      throw Object.assign(new Error('The provider rejected its API key.'), { code: 'provider_auth_failed', body: { retryable: false } });
    } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/rejected its API key/);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps the model an existing agent runs when the list fails', async () => {
    picker({ value: 'my-custom-model', loadModels: async () => { throw new Error('down'); } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/my-custom-model/);
  });

  it('offers the same escape hatch when the provider simply has no models', async () => {
    picker({ loadModels: async () => [] });
    expect(await screen.findByRole('textbox', { name: /model id/i })).toBeTruthy();
  });

  it('does not ask a provider that is not there yet', () => {
    const loadModels = vi.fn(async () => models);
    render(<ModelPicker providerId="" value="" onChange={vi.fn()} loadModels={loadModels} />);
    expect(loadModels).not.toHaveBeenCalled();
  });
});

describe('a model the list does not know', () => {
  it('keeps the model an existing agent already runs', async () => {
    picker({ value: 'some-retired-model' });
    // The agent was built on it; editing anything else about that agent must
    // not silently change which model it runs.
    expect(await screen.findByText(/some-retired-model/)).toBeTruthy();
    expect(screen.getByText(/not in the provider's list/i)).toBeTruthy();
  });

  it('lets a custom id be entered on purpose', async () => {
    const onChange = picker();
    await screen.findByRole('option', { name: /Claude Opus 5/ });

    fireEvent.click(screen.getByRole('button', { name: /use a custom model id/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /model id/i }), { target: { value: 'my-finetune-v3' } });

    expect(onChange).toHaveBeenCalledWith('my-finetune-v3');
  });
});
