import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="run-status-line">There's nothing at this address.</p>
      <Link to="/load-tests" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
        Back to Load Tests
      </Link>
    </div>
  );
}
