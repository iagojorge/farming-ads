import { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCw, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';
import LogEntry from '../components/LogEntry.jsx';

function RunningCard({ profile }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function tick() {
      if (!profile.endsAt) {
        setRemaining('—');
        return;
      }
      const diff = Math.max(0, new Date(profile.endsAt).getTime() - Date.now());
      const total = Math.floor(diff / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      setRemaining(`${m}m ${s.toString().padStart(2, '0')}s`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [profile.endsAt]);

  const statusColor = {
    iniciando: 'text-yellow-400',
    'browser aberto': 'text-blue-400',
    farming: 'text-brand-400',
  }[profile.status] || 'text-gray-400';

  return (
    <div className="card flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-brand-900/50 flex items-center justify-center">
          <User className="w-4 h-4 text-brand-400" />
        </div>
        <div>
          <p className="font-medium text-sm text-gray-100">{profile.name}</p>
          <p className={`text-xs capitalize ${statusColor}`}>{profile.status}</p>
        </div>
      </div>
      {profile.endsAt && profile.status === 'farming' && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Clock className="w-3.5 h-3.5" />
          <span className="tabular-nums">{remaining}</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ workerStatus, liveLog }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  const running = workerStatus?.isRunning ?? false;
  const runningProfiles = workerStatus?.runningProfiles ?? [];

  // Carrega logs iniciais
  useEffect(() => {
    api.getLogs(30).then(setLogs).catch(() => {});
  }, []);

  // Adiciona log em tempo real no topo
  useEffect(() => {
    if (liveLog) {
      setLogs((prev) => [liveLog, ...prev].slice(0, 30));
    }
  }, [liveLog]);

  async function handleStart() {
    setLoading(true);
    try {
      await api.startWorker();
      toast.success('Worker iniciado');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    try {
      await api.stopWorker();
      toast.info('Worker parado');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>

      {/* Status + ações */}
      <div className="card flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Status do Worker</p>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${running ? 'bg-brand-400 animate-pulse' : 'bg-gray-600'}`}
            />
            <span className={`text-lg font-semibold ${running ? 'text-brand-400' : 'text-gray-400'}`}>
              {running ? 'Em execução' : 'Ocioso'}
            </span>
          </div>
          {running && (
            <p className="text-xs text-gray-500 mt-1">
              {runningProfiles.length} perfil(is) ativo(s)
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {running ? (
            <button className="btn-danger" onClick={handleStop} disabled={loading}>
              <Square className="w-4 h-4" />
              Parar
            </button>
          ) : (
            <button className="btn-primary" onClick={handleStart} disabled={loading}>
              <Play className="w-4 h-4" />
              Iniciar Agora
            </button>
          )}
        </div>
      </div>

      {/* Perfis em execução */}
      {runningProfiles.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Perfis Ativos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {runningProfiles.map((p) => (
              <RunningCard key={p.profileId} profile={p} />
            ))}
          </div>
        </section>
      )}

      {/* Log recente */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Atividade Recente
          </h2>
          <button
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition-colors"
            onClick={() => api.getLogs(30).then(setLogs)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
        </div>
        <div className="card" ref={listRef}>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-600 py-4 text-center">Nenhuma atividade ainda.</p>
          ) : (
            logs.map((l) => <LogEntry key={l.id} log={l} />)
          )}
        </div>
      </section>
    </div>
  );
}
