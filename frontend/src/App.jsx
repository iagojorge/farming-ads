import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Profiles from './pages/Profiles.jsx';
import Accounts from './pages/Accounts.jsx';
import Schedule from './pages/Schedule.jsx';
import Settings from './pages/Settings.jsx';
import Logs from './pages/Logs.jsx';
import { createEventSource } from './api/index.js';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [workerStatus, setWorkerStatus] = useState({ isRunning: false, runningProfiles: [] });
  const [loginStatus, setLoginStatus] = useState({ isRunning: false, jobs: [] });
  const [liveLog, setLiveLog] = useState(null);

  useEffect(() => {
    const es = createEventSource((event, data) => {
      if (event === 'status') setWorkerStatus(data);
      if (event === 'log') setLiveLog(data);
      if (event === 'login-status') setLoginStatus(data);
    });
    return () => es.close();
  }, []);

  const pages = { dashboard: Dashboard, profiles: Profiles, accounts: Accounts, schedule: Schedule, settings: Settings, logs: Logs };
  const PageComponent = pages[page] || Dashboard;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar page={page} onNavigate={setPage} workerStatus={workerStatus} />
      <main className="flex-1 overflow-y-auto">
        <PageComponent workerStatus={workerStatus} loginStatus={loginStatus} liveLog={liveLog} />
      </main>
    </div>
  );
}
