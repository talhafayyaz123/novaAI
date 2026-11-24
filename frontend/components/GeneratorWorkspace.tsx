import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

type ContentType =
  | 'email'
  | 'tweet'
  | 'linkedin_post'
  | 'blog_outline'
  | 'product_description'
  | 'business_description'
  | 'project_proposal'
  | 'professional_summary';
type Tone = 'professional' | 'friendly' | 'casual' | 'persuasive' | 'concise';
type Length = 'short' | 'medium' | 'long';

type GenerateResult = {
  content: string;
  content_type: ContentType;
  tone: Tone;
  language: string;
  length: Length;
  tokens_used: number;
};

const contentTypes: { value: ContentType; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'tweet', label: 'Tweet / social post' },
  { value: 'linkedin_post', label: 'LinkedIn post' },
  { value: 'blog_outline', label: 'Blog outline' },
  { value: 'product_description', label: 'Product description' },
  { value: 'business_description', label: 'Business description' },
  { value: 'project_proposal', label: 'Project proposal' },
  { value: 'professional_summary', label: 'Professional summary' },
];

async function responseError(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed with HTTP ${response.status}.`;
  try {
    const body = JSON.parse(text);
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    return `Request failed with HTTP ${response.status}.`;
  }
  return `Request failed with HTTP ${response.status}.`;
}

export function GeneratorWorkspace() {
  const { user, status, logout, authenticatedFetch } = useAuth();
  const [contentType, setContentType] = useState<ContentType>('email');
  const [instructions, setInstructions] = useState('');
  const [tone, setTone] = useState<Tone>('professional');
  const [language, setLanguage] = useState('English');
  const [length, setLength] = useState<Length>('medium');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedInstructions = instructions.trim();
    if (!trimmedInstructions || generating) return;

    setGenerating(true);
    setError(null);
    setCopied(false);
    try {
      const response = await authenticatedFetch('/api/backend/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          instructions: trimmedInstructions,
          tone,
          language,
          length,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setResult((await response.json()) as GenerateResult);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Content could not be generated.');
    } finally {
      setGenerating(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
    } catch {
      setError('Could not copy the result. Select the text and copy it manually.');
    }
  }

  function reset() {
    setInstructions('');
    setResult(null);
    setError(null);
    setCopied(false);
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <main className="auth-page">
        <div className="loading-card" role="status">
          {status === 'loading' ? 'Please wait' : 'Redirecting to sign in…'}
        </div>
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
        <Link className="document-nav-link" href="/documents">Documents <span aria-hidden="true">↗</span></Link>
        <Link className="document-nav-link" href="/study">Study Tools</Link>
        <Link className="document-nav-link" href="/profile">Profile</Link>
        <span className="document-nav-link active" aria-current="page">Generator</span>
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
            <p className="eyebrow">WRITING STUDIO</p>
            <h1>Content Generator</h1>
            <p className="auth-description">Turn a short brief into polished, ready-to-use content.</p>
          </div>
          <ThemeToggle />
        </header>

        <div className="generator-content">
          <section className="document-panel generator-form-panel">
            <p className="eyebrow">CREATE</p>
            <h2>Writing brief</h2>
            <form className="generator-form" onSubmit={(event) => void generate(event)}>
              <label htmlFor="content-type">Content type</label>
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value as ContentType)}
              >
                {contentTypes.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <label htmlFor="instructions">Instructions</label>
              <textarea
                id="instructions"
                maxLength={8000}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Describe the topic, audience, key points, and anything the result should include…"
                rows={9}
                value={instructions}
              />

              <div className="generator-controls">
                <div>
                  <label htmlFor="tone">Tone</label>
                  <select id="tone" value={tone} onChange={(event) => setTone(event.target.value as Tone)}>
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="casual">Casual</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="concise">Concise</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="language">Language</label>
                  <input
                    id="language"
                    maxLength={50}
                    onChange={(event) => setLanguage(event.target.value)}
                    value={language}
                  />
                </div>
                <div>
                  <label htmlFor="length">Length</label>
                  <select id="length" value={length} onChange={(event) => setLength(event.target.value as Length)}>
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </div>
              </div>

              <div className="generator-actions">
                <button className="secondary-button" disabled={!instructions && !result} onClick={reset} type="button">Clear</button>
                <button className="primary-button" disabled={!instructions.trim() || !language.trim() || generating} type="submit">
                  {generating ? 'Generating…' : 'Generate content'}
                </button>
              </div>
            </form>
          </section>

          <section className="document-panel generator-result-panel">
            <div className="document-panel-heading">
              <div>
                <p className="eyebrow">RESULT</p>
                <h2>{result ? contentTypes.find((item) => item.value === result.content_type)?.label : 'Generated content'}</h2>
              </div>
              {result && (
                <button className="secondary-button" onClick={() => void copyResult()} type="button">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {error && <div className="chat-error" role="alert">{error}</div>}
            {generating && <p className="document-muted" role="status">Writing and refining your content…</p>}
            {!result && !generating && <p className="generator-empty">Your generated content will appear here.</p>}
            {result && (
              <article className="generator-result">
                <p>{result.content}</p>
                <div className="generator-meta">
                  <span>{result.language}</span>
                  <span>{result.tone}</span>
                  <span>{result.length}</span>
                  {result.tokens_used > 0 && <span>{result.tokens_used} tokens</span>}
                </div>
              </article>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
