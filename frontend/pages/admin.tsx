import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

type AdminUser = {
  id: number;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type AdminActivity = {
  id: number;
  user_id: number | null;
  email: string | null;
  action: string;
  timestamp: string;
};

type AdminStats = {
  total_users: number;
  total_conversations: number;
  total_ai_requests: number;
  total_documents: number;
  total_tokens_used: number;
  recent_audit: AdminActivity[];
};

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === 'string'
    ? body.detail
    : `Request failed with HTTP ${response.status}.`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function AdminPage() {
  const router = useRouter();
  const { user, status, logout, authenticatedFetch } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    const [statsResponse, usersResponse] = await Promise.all([
      authenticatedFetch('/api/backend/admin/stats'),
      authenticatedFetch('/api/backend/admin/users'),
    ]);
    if (!statsResponse.ok) throw new Error(await responseError(statsResponse));
    if (!usersResponse.ok) throw new Error(await responseError(usersResponse));
    const [statsData, usersData] = await Promise.all([
      statsResponse.json() as Promise<AdminStats>,
      usersResponse.json() as Promise<AdminUser[]>,
    ]);
    setStats(statsData);
    setUsers(usersData);
  }, [authenticatedFetch]);

  const updateUserStatus = useCallback(
    async (target: AdminUser) => {
      const response = await authenticatedFetch(
        `/api/backend/admin/users/${target.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !target.is_active }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      await loadDashboard();
    },
    [authenticatedFetch, loadDashboard],
  );

  useEffect(() => {
    if (status === 'unauthenticated') {
      void router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;
    if (user?.role !== 'admin') {
      void router.replace('/');
      return;
    }

    let active = true;
    void loadDashboard()
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadDashboard, router, status, user?.role]);

  if (status === 'error') {
    return (
      <main className="auth-page">
        <section className="auth-card" role="alert">
          <h1>Admin dashboard unavailable</h1>
          <p className="auth-description">Please check your connection and sign in again.</p>
          <Link className="primary-button auth-submit button-link" href="/login">Go to sign in</Link>
        </section>
      </main>
    );
  }

  if (status === 'loading' || status === 'unauthenticated' || user?.role !== 'admin') {
    return (
      <main className="auth-page">
        <div className="loading-card" role="status">Verifying administrator access…</div>
      </main>
    );
  }

  const metrics = stats
    ? [
        { label: 'Registered users', value: stats.total_users },
        { label: 'Conversations', value: stats.total_conversations },
        { label: 'AI requests', value: stats.total_ai_requests },
        { label: 'Document uploads', value: stats.total_documents },
        { label: 'Tokens recorded', value: stats.total_tokens_used },
      ]
    : [];

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
        <Link className="document-nav-link" href="/study">Study Tools</Link>
        <Link className="document-nav-link" href="/generate">Generator</Link>
        <Link className="document-nav-link" href="/profile">Profile</Link>
        <span className="document-nav-link active" aria-current="page">Admin</span>
        <div className="document-sidebar-user">
          <span className="avatar">{user?.email.charAt(0).toUpperCase()}</span>
          <span className="sidebar-email">{user?.email}</span>
          <button className="signout-icon" onClick={() => void logout()} type="button">Sign out</button>
        </div>
      </aside>

      <section className="document-main admin-main">
        <header className="document-header">
          <div>
            <p className="eyebrow">PLATFORM OVERVIEW</p>
            <h1>Admin dashboard</h1>
            <p className="auth-description">Monitor  usage, users, and recent activity.</p>
          </div>
          <div className="document-header-actions">
            <ThemeToggle />
            <button
              className="secondary-button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError(null);
                void loadDashboard()
                  .catch((loadError: unknown) => {
                    setError(loadError instanceof Error ? loadError.message : 'Could not refresh data.');
                  })
                  .finally(() => setLoading(false));
              }}
              type="button"
            >
              Refresh data
            </button>
          </div>
        </header>

        {error && <div className="chat-error admin-error" role="alert">{error}</div>}
        {loading && !stats ? (
          <p className="document-muted" role="status">Loading dashboard data…</p>
        ) : (
          <>
            <section className="admin-metrics" aria-label="Platform metrics">
              {metrics.map((metric) => (
                <article className="admin-metric-card" key={metric.label}>
                  <p>{metric.label}</p>
                  <strong>{metric.value.toLocaleString()}</strong>
                </article>
              ))}
            </section>

            <section className="admin-panel">
              <div className="document-panel-heading">
                <div>
                  <p className="eyebrow">AUDIT LOG</p>
                  <h2>Recent activity</h2>
                </div>
              </div>
              {stats?.recent_audit.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Activity</th><th>User</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {stats.recent_audit.map((item) => (
                        <tr key={item.id}>
                          <td>{item.action.replace(/[._]/g, ' ')}</td>
                          <td>{item.email ?? `User ${item.user_id ?? 'removed'}`}</td>
                          <td>{formatDate(item.timestamp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="document-empty">
                  {loading ? 'Loading activity…' : 'No activity has been recorded yet.'}
                </p>
              )}
            </section>

            <section className="admin-panel">
              <div className="document-panel-heading">
                <div>
                  <p className="eyebrow">ACCOUNT MANAGEMENT</p>
                  <h2>Users</h2>
                </div>
                <span className="document-count">{users.length}</span>
              </div>
              {users.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {users.map((item) => (
                        <tr key={item.id}>
                          <td>{item.email}</td>
                          <td><span className={`admin-role ${item.role}`}>{item.role}</span></td>
                          <td><span className={`admin-status ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td>{formatDate(item.created_at)}</td>
                          <td>
                            {item.id !== user?.id && (
                              <button
                                className="secondary-button admin-status-button"
                                onClick={() => {
                                  setError(null);
                                  void updateUserStatus(item).catch((updateError: unknown) => {
                                    setError(updateError instanceof Error ? updateError.message : 'Could not update account status.');
                                  });
                                }}
                                type="button"
                              >
                                {item.is_active ? 'Deactivate' : 'Reactivate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="document-empty">{loading ? 'Loading users…' : 'No users found.'}</p>
              )}
            </section>
           
          </>
        )}
      </section>
    </main>
  );
}
