import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { WallyLogo } from '../components/WallyLogo';
import { ApiRequestError } from '../lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/load-tests', { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Login failed — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={(event) => void handleSubmit(event)} className="login-form">
        <div className="login-brand">
          <WallyLogo size={34} />
          <h1>Wally</h1>
        </div>
        <p className="login-subtitle">Sign in to run and monitor agent jobs</p>
        <label>
          Email
          <input value={username} onChange={(event) => setUsername(event.target.value)} type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-hint">admin@wally.dev · manager@wally.dev · viewer@wally.dev</p>
      </form>
    </div>
  );
}
