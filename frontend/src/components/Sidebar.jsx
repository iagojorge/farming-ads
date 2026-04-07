import {
  LayoutDashboard,
  Mail,
  CalendarClock,
  ScrollText,
  Leaf,
  Wifi,
  WifiOff,
  LogOut,
  CheckCircle,
  Shield,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'accounts', label: 'Contas', Icon: Mail },
  { id: 'schedule', label: 'Agendamento', Icon: CalendarClock },
  { id: 'logs', label: 'Logs', Icon: ScrollText },
  { id: 'ready', label: 'Contas Prontas', Icon: CheckCircle },
  { id: 'security', label: 'Segurança', Icon: Shield },
];

export default function Sidebar({ page, onNavigate, workerStatus, onLogout }) {
  const { username } = useAuth();
  const running = workerStatus?.isRunning;
  const count = workerStatus?.runningProfiles?.length ?? 0;

  return (
    <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-brand-400" />
          <span className="font-bold text-gray-100 tracking-wide text-sm">Farming Ads</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              page === id
                ? 'bg-brand-900/60 text-brand-400'
                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      {/* User Info */}
      <div className="px-4 py-3 border-t border-gray-800">
        <div className="text-xs text-gray-500 mb-2">Conectado como</div>
        <div className="text-sm font-medium text-gray-200">{username}</div>
      </div>

      {/* Status */}
      <div className="px-4 py-4 border-t border-gray-800">
        <div
          className={`flex items-center gap-2 text-xs font-medium mb-4 ${
            running ? 'text-brand-400' : 'text-gray-600'
          }`}
        >
          {running ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {running ? `Rodando — ${count} perfil(is)` : 'Worker ocioso'}
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 bg-gray-800/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
