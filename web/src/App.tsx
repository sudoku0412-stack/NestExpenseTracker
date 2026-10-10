import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { useData } from './data';
import { PeriodProvider } from './period';
import Balances from './pages/Balances';
import Budgets from './pages/Budgets';
import Goals from './pages/Goals';
import Recurring from './pages/Recurring';
import Reports from './pages/Reports';
import Dashboard from './pages/Dashboard';
import Incomes from './pages/Incomes';
import Login from './pages/Login';
import Receipts from './pages/Receipts';
import { CURRENCIES } from '@app/lib/currency';

function Shell() {
  const { user, logout } = useAuth();
  const { currency, setCurrency, ready, error } = useData();
  return (
    <PeriodProvider>
      <div className="shell">
        <aside className="side">
          <div className="logo"><img src="/icon.png" alt="" />NestExpenseTracker</div>
          <nav className="nav">
            <NavLink to="/" end>📊 Dashboard</NavLink>
            <NavLink to="/receipts">🧾 Receipts</NavLink>
            <NavLink to="/income">💼 Income</NavLink>
            <NavLink to="/reports">📈 Reports</NavLink>
            <NavLink to="/budgets">🎯 Budgets</NavLink>
            <NavLink to="/goals">🐷 Savings goals</NavLink>
            <NavLink to="/balances">🤝 Balances</NavLink>
            <NavLink to="/recurring">🔁 Recurring</NavLink>
          </nav>
          <div className="foot">
            <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} aria-label="Display currency">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="muted" title={user?.email ?? ''}>{user?.email}</span>
            <button className="btn sm" onClick={() => void logout()}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          {error ? (
            <div className="card"><h2>Can't load your data</h2><p className="sub">{error}</p></div>
          ) : !ready ? (
            <div className="grid" aria-busy="true"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/receipts" element={<Receipts />} />
              <Route path="/income" element={<Incomes />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/balances" element={<Balances />} />
              <Route path="/recurring" element={<Recurring />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </PeriodProvider>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center"><div className="skeleton" style={{ width: 240 }} /></div>;
  return user ? <Shell /> : <Login />;
}
