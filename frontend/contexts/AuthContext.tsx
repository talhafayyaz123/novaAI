import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type AuthUser = {
  id: number;
  email: string;
  role: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
};

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const responseText = await response.text();
  let body: unknown;
  if (responseText) {
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new ApiError(
      response.ok ? 'Invalid server response.' : `Server error (${response.status}).`,
      response.status,
    );
  }
}

  if (!response.ok) {
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? body.detail
        : undefined;
    const message = Array.isArray(detail)
      ? detail
          .map((item) =>
            typeof item === 'object' && item !== null && 'msg' in item
              ? item.msg
              : undefined,
          )
          .filter((item): item is string => typeof item === 'string')
          .join(', ')
      : typeof detail === 'string'
        ? detail
        : `Request failed with HTTP ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

async function getCurrentUser(accessToken: string): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/backend/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  const updateAccessToken = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const authenticate = useCallback(async (path: string, email: string, password: string) => {
    setError(null);
    const tokens = await requestJson<TokenResponse>(path, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    updateAccessToken(tokens.access_token);
    const currentUser = await getCurrentUser(tokens.access_token);
    setUser(currentUser);
    setStatus('authenticated');
  }, [updateAccessToken]);

  const login = useCallback(
    (email: string, password: string) => authenticate('/api/backend/auth/login', email, password),
    [authenticate],
  );

  const register = useCallback(
    (email: string, password: string) =>
      authenticate('/api/backend/auth/register', email, password),
    [authenticate],
  );

  const logout = useCallback(async () => {
    try {
      await requestJson<{ detail: string }>('/api/backend/auth/logout', { method: 'POST' });
      setUser(null);
      updateAccessToken(null);
      setStatus('unauthenticated');
      setError(null);
    } catch (logoutError) {
      setUser(null);
      updateAccessToken(null);
      setError(
        `You were signed out locally, but the server could not confirm logout: ${
          logoutError instanceof Error ? logoutError.message : 'unknown server error'
        }`,
      );
      setStatus('error');
    }
  }, [updateAccessToken]);

  const refreshAccessToken = useCallback(async () => {
    const tokens = await requestJson<TokenResponse>('/api/backend/auth/refresh', {
      method: 'POST',
    });
    updateAccessToken(tokens.access_token);
    return tokens.access_token;
  }, [updateAccessToken]);

  const refreshUser = useCallback(async () => {
    let token = accessTokenRef.current;
    if (!token) token = await refreshAccessToken();
    const currentUser = await getCurrentUser(token);
    setUser(currentUser);
    setStatus('authenticated');
  }, [refreshAccessToken]);

  const authenticatedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      let token = accessTokenRef.current;
      if (!token) {
        token = await refreshAccessToken();
      }

      const send = (access: string) =>
        fetch(path, {
          ...init,
          credentials: 'include',
          headers: {
            ...init.headers,
            Authorization: `Bearer ${access}`,
          },
        });

      let response = await send(token);
      if (response.status === 401) {
        token = await refreshAccessToken();
        response = await send(token);
      }
      if (response.status === 403) {
        updateAccessToken(null);
        setUser(null);
        setStatus('unauthenticated');
        setError('Your account has been deactivated.');
      }
      return response;
    },
    [refreshAccessToken],
  );

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const tokens = await requestJson<TokenResponse>('/api/backend/auth/refresh', {
          method: 'POST',
        });
        if (active) {
          updateAccessToken(tokens.access_token);
        }
        const currentUser = await getCurrentUser(tokens.access_token);
        if (active) {
          setUser(currentUser);
          setStatus('authenticated');
        }
      } catch (requestError) {
        if (!active) return;
        if (
          requestError instanceof ApiError &&
          (requestError.status === 401 || requestError.status === 403)
        ) {
          updateAccessToken(null);
          setUser(null);
          setError(
            requestError.status === 403
              ? 'Your account has been deactivated.'
              : null,
          );
          setStatus('unauthenticated');
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Could not connect to the server.',
        );
        setStatus('error');
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, [updateAccessToken]);

  const value = useMemo(
    () => ({ user, accessToken, status, error, login, register, logout, refreshUser, authenticatedFetch }),
    [user, accessToken, status, error, login, register, logout, refreshUser, authenticatedFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
