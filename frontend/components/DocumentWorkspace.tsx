import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

type DocumentItem = {
  id: number;
  filename: string;
  status: string;
  created_at: string;
};

type Citation = {
  id: string;
  page_number: number | null;
  content: string;
};

type QueryResult = {
  answer: string;
  citations: Citation[];
};

async function responseError(response: Response) {
  const text = await response.text();
  if (text) {
    try {
      const body = JSON.parse(text);
      if (typeof body.detail === 'string') return body.detail;
      if (Array.isArray(body.detail)) {
        return body.detail
          .map((item: { msg?: string }) => item.msg)
          .filter(Boolean)
          .join(', ');
      }
    } catch {
      return `Request failed with HTTP ${response.status}.`;
    }
  }
  return `Request failed with HTTP ${response.status}.`;
}

function documentStatus(status: string) {
  if (status === 'ready') return 'Ready';
  if (status === 'failed') return 'Failed';
  if (status === 'processing') return 'Processing';
  return 'Queued';
}

export function DocumentWorkspace() {
  const { user, status, logout, authenticatedFetch } = useAuth();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === 'ready'),
    [documents],
  );

  const loadDocuments = useCallback(async () => {
    const response = await authenticatedFetch('/api/backend/documents/recent');
    if (!response.ok) throw new Error(await responseError(response));
    const items = (await response.json()) as DocumentItem[];
    setDocuments(items);
    setSelectedDocumentId((current) => {
      if (current !== null && items.some((document) => document.id === current)) {
        return current;
      }
      return items.find((document) => document.status === 'ready')?.id ?? items[0]?.id ?? null;
    });
  }, [authenticatedFetch]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let active = true;

    const refresh = async () => {
      try {
        await loadDocuments();
        if (active) setError(null);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : 'Could not load your documents.',
          );
        }
      } finally {
        if (active) setLoadingDocuments(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadDocuments, status]);

  useEffect(() => {
    setResult(null);
  }, [selectedDocumentId]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await authenticatedFetch('/api/backend/documents/upload', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(await responseError(response));
      setFile(null);
      const input = document.getElementById('document-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!selectedDocumentId || !trimmedQuestion || asking) return;
    setError(null);
    setResult(null);
    setAsking(true);
    try {
      const response = await authenticatedFetch('/api/backend/documents/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: selectedDocumentId, question: trimmedQuestion }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setResult((await response.json()) as QueryResult);
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Could not answer that question.');
    } finally {
      setAsking(false);
    }
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <main className="auth-page">
        <div className="loading-card" role="status">
          {status === 'loading' ? 'Loading your workspace…' : 'Redirecting to sign in…'}
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="auth-page">
        <section className="auth-card" role="alert">
          <h1>Documents unavailable</h1>
          <p className="auth-description">Please check your connection and sign in again.</p>
          <Link className="primary-button auth-submit button-link" href="/login">Go to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="document-app">
      <aside className="document-sidebar">
        <Link className="brand-lockup" href="/" aria-label="NOVA home">
          <span className="brand-mark">N</span>
          <span>NOVA</span>
        </Link>
        <p className="sidebar-caption">WORKSPACE</p>
        <Link className="document-nav-link" href="/">Chat <span aria-hidden="true">↗</span></Link>
        <Link className="document-nav-link" href="/study">Study Tools</Link>
        <Link className="document-nav-link" href="/generate">Generator <span aria-hidden="true">↗</span></Link>
        <Link className="document-nav-link" href="/profile">Profile</Link>
        <span className="document-nav-link active" aria-current="page">Documents</span>
        {user?.role === 'admin' && <Link className="document-nav-link" href="/admin">Admin</Link>}
        <div className="document-sidebar-user">
          <span className="avatar">{user?.email.charAt(0).toUpperCase()}</span>
          <span className="sidebar-email">{user?.email}</span>
          <button className="signout-icon" onClick={() => void logout()} type="button">Sign out</button>
        </div>
      </aside>

      <section className="document-main">
        <header className="document-header">
          <div>
            <p className="eyebrow">YOUR KNOWLEDGE BASE</p>
            <h1>Documents</h1>
            <p className="auth-description">
              Upload a PDF or TXT and ask questions grounded in its contents.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="document-content">
          <section className="document-panel">
            <p className="eyebrow">ADD A SOURCE</p>
            <h2>Upload a document</h2>
            <p className="document-muted">PDF or UTF-8 TXT · up to 15 MB</p>
            <form className="document-upload-form" onSubmit={(event) => void uploadDocument(event)}>
              <input
                accept=".pdf,.txt,application/pdf,text/plain"
                aria-label="Choose a PDF or text file"
                id="document-file"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <button className="primary-button" disabled={!file || uploading} type="submit">
                {uploading ? 'Uploading…' : 'Upload document'}
              </button>
            </form>
          </section>

          <section className="document-panel">
            <div className="document-panel-heading">
              <div>
                <p className="eyebrow">YOUR FILES</p>
                <h2>Recent documents</h2>
              </div>
              <span className="document-count">{documents.length}</span>
            </div>
            {loadingDocuments ? (
              <p className="document-muted" role="status">Loading documents…</p>
            ) : documents.length === 0 ? (
              <p className="document-empty">Your uploaded documents will appear here.</p>
            ) : (
              <div className="document-list">
                {documents.map((item) => (
                  <button
                    aria-pressed={selectedDocumentId === item.id}
                    className={`document-row${selectedDocumentId === item.id ? ' selected' : ''}`}
                    key={item.id}
                    onClick={() => setSelectedDocumentId(item.id)}
                    type="button"
                  >
                    <span className="document-file-icon" aria-hidden="true">
                      {item.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'TXT'}
                    </span>
                    <span className="document-file-name">{item.filename}</span>
                    <span className={`document-status ${item.status}`}>{documentStatus(item.status)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="document-panel document-query-panel">
            <p className="eyebrow">ASK YOUR DOCUMENT</p>
            <h2>{selectedDocument ? selectedDocument.filename : 'Choose a ready document'}</h2>
            {selectedDocument && selectedDocument.status !== 'ready' && (
              <p className="document-muted">
                This document is {documentStatus(selectedDocument.status).toLowerCase()}. Its status refreshes automatically.
              </p>
            )}
            <form className="document-question-form" onSubmit={(event) => void askQuestion(event)}>
              <textarea
                aria-label="Question about this document"
                maxLength={8000}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about this document…"
                rows={3}
                value={question}
                disabled={!readyDocuments.some((item) => item.id === selectedDocumentId) || asking}
              />
              <button
                className="primary-button"
                disabled={!question.trim() || asking || !readyDocuments.some((item) => item.id === selectedDocumentId)}
                type="submit"
              >
                {asking ? 'Searching…' : 'Ask NOVA'}
              </button>
            </form>
            {error && <div className="chat-error" role="alert">{error}</div>}
            {asking && <p className="document-muted" role="status">Finding relevant passages and preparing an answer…</p>}
            {result && (
              <div className="document-answer">
                <p className="eyebrow">ANSWER</p>
                <p className="document-answer-text">{result.answer}</p>
                <div className="document-citations">
                  <p className="eyebrow">SOURCES</p>
                  {result.citations.map((citation) => (
                    <article className="citation-card" key={citation.id}>
                      <strong>[{citation.id}] · Page {citation.page_number ?? 'N/A'}</strong>
                      <p>{citation.content}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
