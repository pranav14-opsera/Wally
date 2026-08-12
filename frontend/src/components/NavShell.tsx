import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { GaugeIcon, HistoryIcon, LogoutIcon, PlugIcon } from './icons';
import { WallyLogo } from './WallyLogo';

const NAV_ITEMS = [
  { to: '/load-tests', label: 'Load Tests', icon: GaugeIcon },
  { to: '/integration', label: 'API Tester', icon: PlugIcon },
  { to: '/api-lifecycle', label: 'API Lifecycle', icon: HistoryIcon },
];

export function NavShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <NavLink to="/load-tests" className="nav-brand">
          <WallyLogo size={26} />
          <span className="nav-brand-name">Wally</span>
        </NavLink>

        <nav className="nav-list">
          {NAV_ITEMS.map(({ to, label, icon: ItemIcon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <ItemIcon />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-footer">
          {user && (
            <div className="user-chip">
              <span className="user-chip-email">{user.email}</span>
              <span className={`role-pill role-${user.role}`}>{user.role}</span>
            </div>
          )}
          <button type="button" onClick={() => void handleLogout()} className="nav-item logout-item">
            <LogoutIcon />
            Log out
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
