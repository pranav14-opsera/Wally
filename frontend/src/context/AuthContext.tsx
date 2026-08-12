import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { apiFetch } from '../lib/api';

export type Role = 'admin' | 'manager' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Restores the session from the access-token cookie on load via GET /me — the cookie itself is httpOnly, so this is the only way the SPA learns who's logged in after a page refresh. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AuthUser>('/api/v1/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string): Promise<void> {
    const result = await apiFetch<{ user: AuthUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(result.user);
  }

  async function logout(): Promise<void> {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
