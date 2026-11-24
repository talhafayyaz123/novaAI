import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';

type AuthFormProps = {
  mode: 'login' | 'register';
};

export function AuthForm({ mode }: AuthFormProps) {
  const isRegister = mode === 'register';
  const router = useRouter();
  const { login, register, status, error: sessionError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      void router.replace('/');
    }
  }, [router, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : 'Something went wrong.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading' || status === 'authenticated') {
    return (
      <main className="auth-page">
        <div className="loading-card" role="status">
          {status === 'loading' ? 'Please Wait' : 'Opening your workspace…'}
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <ThemeToggle />
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="brand-lockup" href="/" aria-label="NOVA home">
          <span className="brand-mark">N</span>
          <span>NOVA</span>
        </Link>

        <div className="auth-heading">
          <p className="eyebrow">{isRegister ? 'GET STARTED' : 'WELCOME BACK'}</p>
          <h1 id="auth-title">{isRegister ? 'Create your account' : 'Sign in to NOVA'}</h1>
         
        </div>

        {(formError || sessionError) && (
          <div className="form-alert" role="alert">
            {formError || sessionError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'}
             minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting
              ? 'Please wait…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
            {!submitting && <span aria-hidden="true">→</span>}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : 'New to NOVA?'}{' '}
          <Link href={isRegister ? '/login' : '/register'}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </section>
    </main>
  );
}
