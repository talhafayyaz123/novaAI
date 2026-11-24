import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === 'string'
    ? body.detail
    : `Request failed with HTTP ${response.status}.`;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, status, logout, authenticatedFetch, refreshUser } = useAuth();
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) setEmail(user.email);
  }, [user]);

  useEffect(() => {
    if (status === 'unauthenticated') void router.replace('/login');
  }, [router, status]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    const changedEmail = email.trim().toLowerCase() !== user?.email.toLowerCase();
    if (!changedEmail && !newPassword) {
      setError('Change your email or enter a new password.');
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password to confirm these changes.');
      return;
    }

    setSaving(true);
    try {
      const body: {
        current_password: string;
        email?: string;
        new_password?: string;
      } = { current_password: currentPassword };
      if (changedEmail) body.email = email.trim();
      if (newPassword) body.new_password = newPassword;

      const response = await authenticatedFetch('/api/backend/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await refreshUser();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Your profile was updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return <main className="auth-page"><div className="loading-card" role="status">Loading your profile…</div></main>;
  }

  return (
    <main className="document-app">
      <aside className="document-sidebar">
        <Link className="brand-lockup" href="/" aria-label="NOVA home">
          <span className="brand-mark">N</span><span>NOVA</span>
        </Link>
        <p className="sidebar-caption">WORKSPACE</p>
        <Link className="document-nav-link" href="/">Chat <span aria-hidden="true">↗</span></Link>
        <Link className="document-nav-link" href="/documents">Documents</Link>
        <Link className="document-nav-link" href="/generate">Generator</Link>
        {user?.role === 'admin' && <Link className="document-nav-link" href="/admin">Admin</Link>}
        <span className="document-nav-link active" aria-current="page">Profile</span>
        <div className="document-sidebar-user">
          <span className="avatar">{user?.email.charAt(0).toUpperCase()}</span>
          <span className="sidebar-email">{user?.email}</span>
          <button className="signout-icon" onClick={() => void logout()} type="button">Sign out</button>
        </div>
      </aside>

      <section className="document-main">
        <header className="document-header">
          <div>
            <p className="eyebrow">ACCOUNT SETTINGS</p>
            <h1>Your profile</h1>
            <p className="auth-description">Update your email or change your password.</p>
          </div>
          <ThemeToggle />
        </header>
        <div className="profile-content">
          <section className="document-panel">
            <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
              <label htmlFor="profile-email">Email address</label>
              <input id="profile-email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />

              <label htmlFor="current-password">Current password <span>(required to save changes)</span></label>
              <input id="current-password" autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} />

              <label htmlFor="new-password">New password <span>(optional)</span></label>
              <input id="new-password" autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} />

              <label htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} type="password" value={confirmPassword} />

              {error && <div className="chat-error" role="alert">{error}</div>}
              {success && <p className="profile-success" role="status">{success}</p>}
              <button className="primary-button profile-submit" disabled={saving} type="submit">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
