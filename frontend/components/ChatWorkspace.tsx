import Link from 'next/link';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MarkdownContent } from './MarkdownContent';
import { ThemeToggle } from './ThemeToggle';

type Conversation = {
  id: number;
  title: string;
  created_at: string;
};

type ChatMessage = {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
};

type StreamEvent = {
  type: 'start' | 'delta' | 'done' | 'error';
  conversation_id?: number;
  content?: string;
  message?: string;
};

const suggestions = [
  'Help me plan my week',
  'Explain a complex topic simply',
  'Draft a thoughtful email',
];

async function responseError(response: Response) {
  const text = await response.text();
  if (text) {
    try {
      const body = JSON.parse(text);
      if (typeof body.detail === 'string') return body.detail;
    } catch {
      return `Request failed with HTTP ${response.status}.`;
    }
  }
  return `Request failed with HTTP ${response.status}.`;
}

export function ChatWorkspace() {
  const { user, status, logout, authenticatedFetch } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(
    async (conversationId: number) => {
      setLoadingHistory(true);
      setError(null);
      try {
        const response = await authenticatedFetch(
          `/api/backend/chat/conversations/${conversationId}/messages`,
        );
        if (!response.ok) throw new Error(await responseError(response));
        setMessages((await response.json()) as ChatMessage[]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load conversation.');
      } finally {
        setLoadingHistory(false);
      }
    },
    [authenticatedFetch],
  );

  const loadConversations = useCallback(async () => {
    const response = await authenticatedFetch('/api/backend/chat/conversations');
    if (!response.ok) throw new Error(await responseError(response));
    const items = (await response.json()) as Conversation[];
    setConversations(items);
    if (items.length > 0) {
      setActiveConversationId(items[0].id);
      await loadMessages(items[0].id);
    }
  }, [authenticatedFetch, loadMessages]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    void loadConversations().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load chat history.');
    });
  }, [loadConversations, status]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  function startNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    setDraft('');
    setError(null);
  }

  async function renameConversation(conversationId: number, currentTitle: string) {
    const title = window.prompt('Rename conversation', currentTitle);
    if (!title?.trim()) return;
    try {
      const response = await authenticatedFetch(
        `/api/backend/chat/conversations/${conversationId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      await loadConversations();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not rename conversation.');
    }
  }

  async function deleteConversation(conversationId: number) {
    if (!window.confirm('Delete this conversation and all its messages?')) return;
    try {
      const response = await authenticatedFetch(
        `/api/backend/chat/conversations/${conversationId}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error(await responseError(response));
      if (activeConversationId === conversationId) startNewChat();
      await loadConversations();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not delete conversation.');
    }
  }

  async function deleteAllConversations() {
    if (!conversations.length || !window.confirm('Delete all your conversations and messages? This cannot be undone.')) return;
    try {
      const response = await authenticatedFetch('/api/backend/chat/conversations', {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await responseError(response));
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not clear conversation history.');
    }
  }

  async function summarizeConversation(conversationId: number) {
    try {
      setLoadingHistory(true);
      setError(null);
      const response = await authenticatedFetch(
        `/api/backend/chat/conversations/${conversationId}/summarize`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error(await responseError(response));
      await loadMessages(conversationId);
      setError('Conversation summary updated. It will be used as memory in future replies.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not summarize conversation.');
    } finally {
      setLoadingHistory(false);
    }
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    setDraft('');
    setError(null);
    setSending(true);

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: 'user', content },
      { id: assistantMessageId, role: 'assistant', content: '' },
    ]);

    try {
      const response = await authenticatedFetch('/api/backend/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversation_id: activeConversationId,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.body) throw new Error('The server did not start a chat stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;
      let completed = false;

      const applyFrame = (frame: string) => {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) return;

        const item = JSON.parse(data) as StreamEvent;
        if (item.type === 'start' && item.conversation_id) {
          const conversationId = item.conversation_id;
          setActiveConversationId(conversationId);
          setConversations((current) => {
            if (current.some((conversation) => conversation.id === conversationId)) {
              return current;
            }
            return [
              {
                id: conversationId,
                title: content.replace(/\s+/g, ' ').slice(0, 72) || 'New conversation',
                created_at: new Date().toISOString(),
              },
              ...current,
            ];
          });
        } else if (item.type === 'delta' && item.content) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: message.content + item.content }
                : message,
            ),
          );
        } else if (item.type === 'error') {
          streamError = item.message || 'The assistant could not complete the response.';
        } else if (item.type === 'done') {
          completed = true;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
          applyFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + separator.length);
          boundary = buffer.search(/\r?\n\r?\n/);
        }
        if (done) break;
      }
      if (buffer.trim()) applyFrame(buffer);
      if (streamError) throw new Error(streamError);
      if (!completed) throw new Error('The chat stream ended before the response completed.');
      await loadConversations();
    } catch (sendError) {
      setMessages((current) =>
        current.filter(
          (message) => message.id !== assistantMessageId || message.content.length > 0,
        ),
      );
      setError(sendError instanceof Error ? sendError.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main className="chat-app">
      <aside className="chat-sidebar">
        <Link className="brand-lockup" href="/" aria-label="NOVA home">
          <span className="brand-mark">N</span>
          <span>NOVA</span>
        </Link>

        <button className="new-chat-button" onClick={startNewChat} type="button">
          <span aria-hidden="true">＋</span> New chat
        </button>
        <Link className="document-sidebar-link" href="/documents">
          <span aria-hidden="true">▤</span> Documents
        </Link>
        <Link className="document-sidebar-link" href="/study">
          <span aria-hidden="true">✓</span> Study Tools
        </Link>
        <Link className="document-sidebar-link" href="/generate">
          <span aria-hidden="true">✦</span> Generator
        </Link>
        <Link className="document-sidebar-link" href="/profile">
          <span aria-hidden="true">◉</span> Profile
        </Link>
        {user?.role === 'admin' && (
          <Link className="document-sidebar-link" href="/admin">
            <span aria-hidden="true">◫</span> Admin
          </Link>
        )}

        <div className="sidebar-caption">RECENT</div>
        {conversations.length > 0 && (
          <button className="clear-history-button" onClick={() => void deleteAllConversations()} type="button">
            Clear all chats
          </button>
        )}
        <nav className="conversation-list" aria-label="Recent conversations">
          {conversations.map((conversation) => (
            <div className="conversation-row" key={conversation.id}>
              <button
                className={`conversation-link${activeConversationId === conversation.id ? ' selected' : ''}`}
                onClick={() => {
                  setActiveConversationId(conversation.id);
                  void loadMessages(conversation.id);
                }}
                type="button"
                title={conversation.title}
              >
                <span aria-hidden="true">◌</span>
                <span>{conversation.title}</span>
              </button>
              <button
                className="conversation-action"
                aria-label={`Summarize ${conversation.title}`}
                onClick={() => void summarizeConversation(conversation.id)}
                type="button"
              >S</button>
              <button
                className="conversation-action"
                aria-label={`Rename ${conversation.title}`}
                onClick={() => void renameConversation(conversation.id, conversation.title)}
                type="button"
              >R</button>
              <button
                className="conversation-action"
                aria-label={`Delete ${conversation.title}`}
                onClick={() => void deleteConversation(conversation.id)}
                type="button"
              >×</button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="conversation-empty">Your conversations will appear here.</p>
          )}
        </nav>

        <div className="sidebar-bottom">
          <span className="avatar">{user?.email.charAt(0).toUpperCase()}</span>
          <span className="sidebar-email">{user?.email}</span>
          <button className="signout-icon" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div>
            <p className="eyebrow">NOVA ASSISTANT</p>
            <h1>Chat</h1>
          </div>
          <div className="chat-header-actions">
            <span className="chat-model-label">Chat Assistant</span>
            <ThemeToggle />
          </div>
        </header>

        <div className={`chat-transcript${messages.length === 0 ? ' empty' : ''}`} role="log" aria-live="polite">
          {loadingHistory ? (
            <div className="chat-loading" role="status">Loading conversation…</div>
          ) : messages.length === 0 ? (
            <div className="chat-welcome">
              <div className="welcome-orb" aria-hidden="true">✦</div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2>What would you like to work on?</h2>
              <p>Ask a question, explore an idea, or get help with a task.</p>
              <div className="suggestion-list">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setDraft(suggestion)}
                    type="button"
                  >
                    {suggestion}<span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  {message.role === 'assistant' && (
                    <span className="message-avatar" aria-hidden="true">N</span>
                  )}
                  <div className="message-content">
                    <div className="message-author">
                      {message.role === 'assistant' ? 'NOVA' : 'You'}
                    </div>
                    {message.content && message.role === 'assistant' ? (
                      <MarkdownContent content={message.content} />
                    ) : (
                      <p>{message.content || (sending ? 'Thinking…' : '')}</p>
                    )}
                  </div>
                </article>
              ))}
              <div ref={messageEndRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="chat-error" role="alert">{error}</div>}
          <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
            <textarea
              aria-label="Message NOVA"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message …"
              rows={1}
              value={draft}
              disabled={sending || status !== 'authenticated'}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || sending || status !== 'authenticated'}
            >
              {sending ? '…' : '↑'}
            </button>
          </form>
          <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
        </div>
      </section>
    </main>
  );
}
