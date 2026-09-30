import { Children, cloneElement, isValidElement, useMemo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent } from '../../types';

/** Markdown is rendered as React elements: raw HTML and unsafe URLs are never executed. */
export function MessageBody({ body, agents, onAgentClick, streaming = false, renderMentions }: {
  body: string;
  agents: Agent[];
  onAgentClick: (id: string) => void;
  streaming?: boolean;
  renderMentions: (body: string, agents: Agent[], onAgentClick: (id: string) => void) => ReactNode;
}) {
  const components = useMemo(() => {
    const mentions = (children: ReactNode): ReactNode => Children.map(children, (child) => {
      if (typeof child === 'string') return renderMentions(child, agents, onAgentClick);
      if (!isValidElement<{ children?: ReactNode }>(child)) return child;
      // Code and links are literal. An @ inside a URL or snippet is not a mention.
      if (child.type === 'code' || child.type === 'a' || child.type === 'pre'
        || child.type === 'button' || child.type === 'mark'
        || child.props && 'href' in child.props) return child;
      return cloneElement(child, {}, mentions(child.props.children));
    });
    return {
      p: ({ children }: { children?: ReactNode }) => <p>{mentions(children)}</p>,
      li: ({ children }: { children?: ReactNode }) => <li>{mentions(children)}</li>,
      th: ({ children }: { children?: ReactNode }) => <th>{mentions(children)}</th>,
      td: ({ children }: { children?: ReactNode }) => <td>{mentions(children)}</td>,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => href
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      // Do not load remote tracking images from model output; offer a deliberate link instead.
      img: ({ src, alt }: { src?: string; alt?: string }) => src
        ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'View image'}</a> : <span>{alt}</span>,
      pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
      table: ({ children }: { children?: ReactNode }) => <div className="message-table"><table>{children}</table></div>,
    };
  }, [agents, onAgentClick, renderMentions]);
  return <div className="message-markdown">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{body}</Markdown>
    {streaming && <i className="cursor" aria-label="Generating reply" />}
  </div>;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = (node: ReactNode): string => Children.toArray(node).map((child) =>
    typeof child === 'string' || typeof child === 'number' ? String(child)
      : isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : '').join('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text(children)); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
  };
  return <div className="message-code">
    <button type="button" onClick={() => void copy()} aria-label="Copy code">{copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}</button>
    <pre>{children}</pre>
  </div>;
}
