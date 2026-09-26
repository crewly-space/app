// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarSection } from '../src/features/shell/SidebarSection';

afterEach(cleanup);

describe('a sidebar section with an action', () => {
  it('offers the action to someone allowed to take it', () => {
    const create = vi.fn();
    render(<SidebarSection title="Channels" action={create} actionLabel="Create channel"><p>rows</p></SidebarSection>);
    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(create).toHaveBeenCalledOnce();
  });

  it('keeps the action visible but disabled, with the reason, for someone who is not', () => {
    const create = vi.fn();
    render(
      <SidebarSection title="Channels" action={create} actionLabel="Create channel"
        actionDisabledReason="Only admins can create channels"><p>rows</p></SidebarSection>,
    );
    const button = screen.getByRole('button', { name: /Create channel: Only admins can create channels/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(create).not.toHaveBeenCalled();
  });
});
