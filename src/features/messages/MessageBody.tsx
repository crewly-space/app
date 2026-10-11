import { Children, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent } from '../../types';
import { renderMentions } from './mentions';

/** Markdown remains text: raw HTML and remote images cannot execute or track readers. */
export function MessageBody({ body, agents, onAgentClick }: { body: string; agents: Agent[]; onAgentClick: (id: string) => void }) {
  const mentions = (children: ReactNode) => Children.map(children, (child) => typeof child === 'string' ? renderMentions(child, agents, onAgentClick) : child);
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    p: ({ children }) => <p>{mentions(children)}</p>,
    li: ({ children }) => <li>{mentions(children)}</li>,
    strong: ({ children }) => <strong>{mentions(children)}</strong>,
    em: ({ children }) => <em>{mentions(children)}</em>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'Open image'}</a>,
  }}>{body}</Markdown></div>;
}
