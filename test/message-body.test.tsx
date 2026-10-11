// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageBody } from '../src/features/messages/MessageBody';

afterEach(cleanup);
it('renders code, lists and links while keeping raw HTML and unsafe URLs inert', () => {
  const { container } = render(<MessageBody body={'**Launch**\n\n- first task\n- second task\n\n```js\nconst x = 1;\n```\n\n[docs](https://example.com)\n\n[unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![tracking](https://example.com/pixel.png)'} agents={[]} onAgentClick={vi.fn()} />);
  expect(container.querySelector('strong')?.textContent).toBe('Launch');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  expect(container.querySelector('pre code')?.textContent).toContain('const x = 1;');
  expect(screen.getByRole('link', { name: 'docs' }).getAttribute('rel')).toBe('noopener noreferrer');
  expect(container.querySelector('[href^="javascript:"]')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});
