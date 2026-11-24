import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../contexts/AuthContext';

type StudyKind = 'summary' | 'notes' | 'quiz';

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

type StudyQuestion = {
  id: number;
  question: string;
  options: string[];
  citations: Citation[];
};

type StudyResult = {
  session_id: number;
  kind: StudyKind;
  content: string | null;
  citations: Citation[];
  questions: StudyQuestion[];
};

type AnswerResult = {
  is_correct: boolean;
  correct_option?: number;
  correct_answer?: string;
  explanation?: string;
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

const studyKinds: { value: StudyKind; label: string; description: string }[] = [
  { value: 'summary', label: 'Summary', description: 'Review the main ideas and key facts.' },
  { value: 'notes', label: 'Notes', description: 'Create organized notes for studying.' },
  { value: 'quiz', label: 'Multiple-choice quiz', description: 'Practice with questions and feedback.' },
];

export function StudyWorkspace() {
  const { user, status, logout, authenticatedFetch } = useAuth();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [kind, setKind] = useState<StudyKind>('summary');
  const [questionCount, setQuestionCount] = useState(5);
  const [result, setResult] = useState<StudyResult | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [answerResults, setAnswerResults] = useState<Record<number, AnswerResult>>({});
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [answeringQuestionId, setAnsweringQuestionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === 'ready'),
    [documents],
  );
  const selectedDocument = useMemo(
    () => readyDocuments.find((document) => document.id === selectedDocumentId) ?? null,
    [readyDocuments, selectedDocumentId],
  );

  const loadDocuments = useCallback(async () => {
    const response = await authenticatedFetch('/api/backend/documents/recent');
    if (!response.ok) throw new Error(await responseError(response));
    const items = (await response.json()) as DocumentItem[];
    setDocuments(items);
    setSelectedDocumentId((current) => {
      if (current !== null && items.some((document) => document.id === current && document.status === 'ready')) {
        return current;
      }
      return items.find((document) => document.status === 'ready')?.id ?? null;
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
          setError(loadError instanceof Error ? loadError.message : 'Could not load your documents.');
        }
      } finally {
        if (active) setLoadingDocuments(false);
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, [loadDocuments, status]);

  useEffect(() => {
    setResult(null);
    setSelectedAnswers({});
    setAnswerResults({});
  }, [selectedDocumentId, kind]);

  async function generateStudyMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDocumentId || generating) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setSelectedAnswers({});
    setAnswerResults({});
    try {
      const response = await authenticatedFetch('/api/backend/study/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: selectedDocumentId,
          kind,
          question_count: questionCount,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setResult((await response.json()) as StudyResult);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : 'Could not generate study material.',
      );
    } finally {
      setGenerating(false);
    }
  }

  async function submitAnswer(question: StudyQuestion) {
    const selectedOption = selectedAnswers[question.id];
    if (!result || selectedOption === undefined || answeringQuestionId !== null) return;
    setAnsweringQuestionId(question.id);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `/api/backend/study/sessions/${result.session_id}/questions/${question.id}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected_option: selectedOption }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const answer = (await response.json()) as AnswerResult;
      setAnswerResults((current) => ({
        ...current,
        [question.id]: answer,
      }));
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : 'Could not check that answer.');
    } finally {
      setAnsweringQuestionId(null);
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
          <h1>Study Tools unavailable</h1>
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
        <Link className="document-nav-link" href="/documents">Documents</Link>
        <span className="document-nav-link active" aria-current="page">Study Tools</span>
        <Link className="document-nav-link" href="/generate">Generator</Link>
        <Link className="document-nav-link" href="/profile">Profile</Link>
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
            <p className="eyebrow">LEARN FROM YOUR FILES</p>
            <h1>Study Tools</h1>
            <p className="auth-description">
              Create summaries, notes, or a quiz grounded in your document.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="generator-content study-content">
          <section className="document-panel">
            <p className="eyebrow">CREATE STUDY MATERIAL</p>
            <h2>Choose a document and format</h2>
            <form className="generator-form" onSubmit={(event) => void generateStudyMaterial(event)}>
              <label htmlFor="study-document">Ready document</label>
              <select
                id="study-document"
                onChange={(event) => setSelectedDocumentId(Number(event.target.value))}
                value={selectedDocumentId ?? ''}
                disabled={loadingDocuments || readyDocuments.length === 0 || generating}
              >
                <option value="" disabled>
                  {loadingDocuments ? 'Loading documents…' : 'Select a ready document'}
                </option>
                {readyDocuments.map((document) => (
                  <option key={document.id} value={document.id}>{document.filename}</option>
                ))}
              </select>

              <label htmlFor="study-kind">Study material</label>
              <select
                id="study-kind"
                onChange={(event) => setKind(event.target.value as StudyKind)}
                value={kind}
                disabled={generating}
              >
                {studyKinds.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="document-muted">
                {studyKinds.find((option) => option.value === kind)?.description}
              </p>

              {kind === 'quiz' && (
                <>
                  <label htmlFor="study-question-count">Number of questions</label>
                  <select
                    id="study-question-count"
                    onChange={(event) => setQuestionCount(Number(event.target.value))}
                    value={questionCount}
                    disabled={generating}
                  >
                    {[3, 5, 8, 10].map((count) => (
                      <option key={count} value={count}>{count} questions</option>
                    ))}
                  </select>
                </>
              )}

              <p className="study-grounding-note">
                Study material is based on relevant passages retrieved from the selected document.
              </p>
              {!loadingDocuments && readyDocuments.length === 0 && (
                <p className="document-empty">
                  No ready documents yet. <Link href="/documents">Upload a PDF or TXT document</Link>.
                </p>
              )}
              <button
                className="primary-button"
                disabled={!selectedDocumentId || generating || readyDocuments.length === 0}
                type="submit"
              >
                {generating ? 'Preparing…' : `Generate ${kind === 'quiz' ? 'quiz' : kind}`}
              </button>
            </form>
          </section>

          <section className="document-panel study-result-panel">
            <div className="document-panel-heading">
              <div>
                <p className="eyebrow">STUDY RESULT</p>
                <h2>{selectedDocument?.filename ?? 'Your study material'}</h2>
              </div>
              {result && <span className="document-count">{result.kind}</span>}
            </div>
            {error && <div className="chat-error" role="alert">{error}</div>}
            {generating && (
              <p className="document-muted" role="status">
                Finding relevant passages and preparing your {kind}…
              </p>
            )}
            {!result && !generating && (
              <p className="generator-empty">Generated study material will appear here.</p>
            )}
            {result?.content && (
              <div className="study-generated-content">
                <MarkdownContent content={result.content} />
                <CitationList citations={result.citations} />
              </div>
            )}
            {result?.kind === 'quiz' && (
              <div className="study-quiz-list">
                {result.questions.map((question, index) => {
                  const answer = answerResults[question.id];
                  const selectedOption = selectedAnswers[question.id];
                  const submitting = answeringQuestionId === question.id;
                  return (
                    <article className="study-question-card" key={question.id}>
                      <p className="eyebrow">QUESTION {index + 1}</p>
                      <h3>{question.question}</h3>
                      <fieldset
                        aria-label={`Answer choices for question ${index + 1}`}
                        className="study-options"
                        disabled={Boolean(answer) || submitting}
                      >
                        {question.options.map((option, optionIndex) => (
                          <label className="study-option" key={optionIndex}>
                            <input
                              checked={selectedOption === optionIndex}
                              name={`study-question-${question.id}`}
                              onChange={() => setSelectedAnswers((current) => ({
                                ...current,
                                [question.id]: optionIndex,
                              }))}
                              type="radio"
                              value={optionIndex}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </fieldset>
                      <button
                        className="secondary-button study-submit-answer"
                        disabled={selectedOption === undefined || Boolean(answer) || submitting}
                        onClick={() => void submitAnswer(question)}
                        type="button"
                      >
                        {submitting ? 'Checking…' : 'Check answer'}
                      </button>
                      {answer && (
                        <div
                          className={`study-feedback${answer.is_correct ? ' correct' : ' incorrect'}`}
                          role="status"
                        >
                          {answer.is_correct ? (
                            <strong>Correct answer.</strong>
                          ) : (
                            <>
                              <strong>Not quite. Correct answer: {answer.correct_answer}</strong>
                              <p>{answer.explanation}</p>
                            </>
                          )}
                        </div>
                      )}
                      <CitationList citations={question.citations} />
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="study-citations">
      <p className="eyebrow">SOURCE PASSAGES</p>
      {citations.map((citation) => (
        <article className="citation-card" key={citation.id}>
          <strong>[{citation.id}] · Page {citation.page_number ?? 'N/A'}</strong>
          <p>{citation.content}</p>
        </article>
      ))}
    </div>
  );
}
