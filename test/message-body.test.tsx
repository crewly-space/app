// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageBody } from '../src/features/messages/MessageBody';
import { renderMentions } from '../src/features/messages/MessageItem';
import type { Agent } from '../src/types';

afterEach(cleanup);
const agent: Agent = { id: 'a1', name: 'Maya', initials: 'M', role: 'Assistant', color: '#123456', status: 'online', model: 'm', providerId: 'p', runtime: 'Chat', memory: [] };
const renderBody = (body: string, onAgentClick = vi.fn(), streaming = false) => render(
  <MessageBody body={body} agents={[agent]} onAgentClick={onAgentClick} streaming={streaming} renderMentions={renderMentions} />,
);

describe('rich conversation messages', () => {
  it('renders the screenshot-style reply with real emphasis, lists and paragraphs', () => {
    const { container } = renderBody('Gotowe.\n\n1. **Przypomnienie:** za godzinę\n2. *Zadanie:* jutro\n\n[Dokumentacja](https://crewly.space)');
    expect(container.querySelector('ol')?.children).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('Przypomnienie:');
    expect(container.querySelector('em')?.textContent).toBe('Zadanie:');
    expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).not.toContain('**');
  });

  it('keeps mentions clickable inside formatting but preserves literal code and link labels', () => {
    const click = vi.fn();
    const { container } = renderBody('**Hej @Maya**\n\n- @Maya sprawdź to\n\n- Drugi element\n\n`@Maya`\n\n[@Maya](https://crewly.space)', click);
    const mentions = container.querySelectorAll('button.mention');
    expect(mentions).toHaveLength(2);
    fireEvent.click(mentions[0]!);
    expect(click).toHaveBeenCalledWith('a1');
    expect(container.querySelector('code')?.textContent).toBe('@Maya');
    expect(container.querySelector('a button')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('copies a multiline fenced snippet exactly and renders tables', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = renderBody('```js\nconst a = 1;\nconsole.log(a);\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;\nconsole.log(a);\n'));
    expect(screen.getByText('Copied')).toBeTruthy();
    expect(container.querySelectorAll('table td')).toHaveLength(2);
  });

  it('blocks unsafe links and raw HTML, and never loads remote tracking images', () => {
    const { container } = renderBody('[bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![Preview](https://example.com/tracker.png)');
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('https://example.com/tracker.png');
  });

  it('handles incomplete streaming Markdown and an unavailable clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    renderBody('**Working\n\n```js\nconsole.log(1)', undefined, true);
    expect(screen.getByLabelText('Generating reply')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByText('Copy failed')).toBeTruthy());
  });
});
