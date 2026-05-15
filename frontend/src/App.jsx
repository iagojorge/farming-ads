import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { useAuth } from './hooks/useAuth.js';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import Schedule from './pages/Schedule.jsx';
import Logs from './pages/Logs.jsx';
import Login from './pages/Login.jsx';
import ReadyAccounts from './pages/ReadyAccounts.jsx';
import Security from './pages/Security.jsx';
import Cards from './pages/Cards.jsx';
import { createEventSource } from './api/index.js';

function ProtectedApp() {
  const [page, setPage] = useState('dashboard');
  const [workerStatus, setWorkerStatus] = useState({ isRunning: false, runningProfiles: [] });
  const [loginStatus, setLoginStatus] = useState({ isRunning: false, jobs: [] });
  const [liveLog, setLiveLog] = useState(null);
  const [accountUpdates, setAccountUpdates] = useState(null);
  const { logout, getToken } = useAuth();

  useEffect(() => {
    const es = createEventSource(
      (event, data) => {
        if (event === 'status') setWorkerStatus(data);
        if (event === 'log') setLiveLog(data);
        if (event === 'login-status') setLoginStatus(data);
        if (event === 'account-update') setAccountUpdates(data);
        if (event === 'warming-status') setWorkerStatus((prev) => ({ ...prev, ...data }));

        if (event === 'captcha_required') {
          toast.warning(
            `🤖 CAPTCHA necessário — ${data.email}\nResolva no browser aberto e o login continuará automaticamente.`,
            { id: `captcha-${data.email}`, duration: Infinity, closeButton: true }
          );
        }
        if (event === 'captcha_resolved') {
          toast.success(`✅ CAPTCHA resolvido — ${data.email}`, { id: `captcha-${data.email}`, duration: 4000 });
        }
        if (event === 'captcha_timeout') {
          toast.error(`❌ CAPTCHA não resolvido em 5 min — ${data.email}`, { id: `captcha-${data.email}`, duration: 8000 });
        }
      },
      getToken()
    );
    return () => es.close();
  }, [getToken]);

  const pages = { dashboard: Dashboard, accounts: Accounts, schedule: Schedule, logs: Logs, ready: ReadyAccounts, security: Security, cards: Cards };
  const PageComponent = pages[page] || Dashboard;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar 
        page={page} 
        onNavigate={setPage} 
        workerStatus={workerStatus}
        onLogout={logout}
      />
      <main className="flex-1 overflow-y-auto">
        <PageComponent 
          workerStatus={workerStatus} 
          loginStatus={loginStatus} 
          liveLog={liveLog} 
          accountUpdates={accountUpdates} 
        />
      </main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Carregando...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route 
        path="/*" 
        element={isAuthenticated ? <ProtectedApp /> : <Navigate to="/login" replace />} 
      />
    </Routes>
  );
}
