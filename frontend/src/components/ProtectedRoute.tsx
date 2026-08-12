import { Navigate, Outlet } from 'react-router-dom';

import type { Role } from '../context/AuthContext';
import { useAuth } from '../context/AuthContext';

const ROLE_LEVEL: Record<Role, number> = { viewer: 1, manager: 2, admin: 3 };

/**
 * UI-only gating (hides/redirects) — the real authorization boundary is
 * the gateway's RBAC middleware. A user who forges a route past this
 * component still gets a 403 from the API, same as WO-041's "never rely
 * on client-side role checks" constraint.
 */
export function ProtectedRoute({ minRole = 'viewer' }: { minRole?: Role }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minRole]) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
