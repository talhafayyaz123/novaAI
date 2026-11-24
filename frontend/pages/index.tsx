import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ChatWorkspace } from '../components/ChatWorkspace';

export default function HomePage() {
  const router = useRouter();
  const { status, error } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      void router.replace('/login');
    }
  }, [router, status]);

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
          <Link className="brand-lockup" href="/">
            <span className="brand-mark">N</span>
            <span>NOVA</span>
          </Link>
          <div className="auth-heading">
            <p className="eyebrow">CONNECTION ISSUE</p>
            <h1>Workspace unavailable</h1>
            <p className="auth-description">{error}</p>
          </div>
          <Link className="primary-button auth-submit button-link" href="/login">
            Go to sign in <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>
    );
  }

  return <ChatWorkspace />;
}
