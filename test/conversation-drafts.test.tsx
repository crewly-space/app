// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { clearConversationDrafts, useConversationDraft, type ConversationDraft } from '../src/features/messages/useConversationDraft';

let restore: (id: string, draft: ConversationDraft) => void;
let capture: () => ConversationDraft;
function Editor({ server = 'one', conversation }: { server?: string; conversation: string }) {
  const draft = useConversationDraft(server, conversation);
  restore = draft.restoreDraft;
  capture = draft.captureDraft;
  return <><div role="textbox" ref={draft.bindComposer} contentEditable suppressContentEditableWarning
    onInput={(event) => draft.setComposer(event.currentTarget.textContent ?? '')} /><output>{draft.composer}</output></>;
}
beforeEach(clearConversationDrafts);
afterEach(cleanup);

it('keeps drafts and mention tokens in their conversation when switching away and back', () => {
  const view = render(<Editor conversation="a" />);
  const editor = screen.getByRole('textbox');
  const mention = document.createElement('span');
  mention.dataset.mentionId = 'agent-1'; mention.textContent = '@Echo';
  editor.append(mention, document.createTextNode(' help'));
  fireEvent.input(editor);
  view.rerender(<Editor conversation="b" />);
  expect(editor.textContent).toBe('');
  editor.textContent = 'B draft'; fireEvent.input(editor);
  view.rerender(<Editor conversation="a" />);
  expect(editor.textContent).toBe('@Echo help');
  expect(editor.querySelector('span')?.dataset.mentionId).toBe('agent-1');
  view.rerender(<Editor conversation="b" />);
  expect(editor.textContent).toBe('B draft');
});

it('retains drafts when returning to a server, without mixing identical conversation ids', () => {
  const view = render(<Editor conversation="same" />);
  screen.getByRole('textbox').textContent = 'Server one'; fireEvent.input(screen.getByRole('textbox'));
  view.rerender(<Editor server="two" conversation="same" />);
  expect(screen.getByRole('textbox').textContent).toBe('');
  view.rerender(<Editor conversation="same" />);
  expect(screen.getByRole('textbox').textContent).toBe('Server one');
});

it('restores a failed send to its original conversation after the user switches', () => {
  const view = render(<Editor conversation="a" />);
  screen.getByRole('textbox').textContent = 'Send me'; fireEvent.input(screen.getByRole('textbox'));
  const failed = capture();
  screen.getByRole('textbox').textContent = ''; fireEvent.input(screen.getByRole('textbox'));
  view.rerender(<Editor conversation="b" />);
  screen.getByRole('textbox').textContent = 'Keep me'; fireEvent.input(screen.getByRole('textbox'));
  act(() => restore('a', failed));
  expect(screen.getByRole('textbox').textContent).toBe('Keep me');
  view.rerender(<Editor conversation="a" />);
  expect(screen.getByRole('textbox').textContent).toBe('Send me');
});

it('forgets drafts on logout even when the editor unmounts after the event', () => {
  const view = render(<Editor conversation="a" />);
  screen.getByRole('textbox').textContent = 'Private'; fireEvent.input(screen.getByRole('textbox'));
  window.dispatchEvent(new Event('crewly:logout'));
  view.unmount();
  render(<Editor conversation="a" />);
  expect(screen.getByRole('textbox').textContent).toBe('');
});


it('restores both the visible text and send state under StrictMode', () => {
  const initial = render(<Editor conversation="a" />);
  screen.getByRole('textbox').textContent = 'Saved'; fireEvent.input(screen.getByRole('textbox'));
  initial.unmount();
  render(<StrictMode><Editor conversation="a" /></StrictMode>);
  expect(screen.getByRole('textbox').textContent).toBe('Saved');
  expect(screen.getByRole('status').textContent).toBe('Saved');
});

it('keeps new typing when an earlier message fails in the same conversation', () => {
  render(<Editor conversation="a" />);
  const editor = screen.getByRole('textbox');
  editor.textContent = 'Earlier message'; fireEvent.input(editor); const failed = capture();
  editor.textContent = 'New thought'; fireEvent.input(editor);
  act(() => restore('a', failed));
  expect(editor.textContent).toBe('Earlier message\n\nNew thought');
  expect(screen.getByRole('status').textContent).toBe('Earlier message\n\nNew thought');
});
