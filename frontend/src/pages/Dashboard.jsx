import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Clock, Zap, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';
import LogEntry from '../components/LogEntry.jsx';

// Componente para exibir conta aquecendo
function WarmingAccountCard({ account }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!account.warmupStartTime) return;

    function tick() {
      const started = new Date(account.warmupStartTime).getTime();
      const elapsed = Date.now() - started;
      const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));
      const hours = Math.floor((elapsed % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
      setRemaining(`${days}d ${hours}h ${mins}m`);
    }
    tick();
    const id = setInterval(tick, 30000); // Atualiza a cada 30s
    return () => clearInterval(id);
  }, [account.warmupStartTime]);

  const stepColor = {
    gmail: 'text-blue-400',
    youtube: 'text-red-400',
    globo: 'text-yellow-400',
    done: 'text-green-400',
  }[account.warmupCurrentStep] || 'text-gray-400';

  const stepLabel = {
    gmail: 'Gmail',
    youtube: 'YouTube',
    globo: 'Globo',
    done: 'Concluído',
  }[account.warmupCurrentStep] || account.warmupCurrentStep;

  return (
    <div className="card bg-gray-800/50 border border-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-medium text-sm text-gray-100 truncate">{account.email}</p>
          <div className="flex items-center gap-2 mt-1">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <p className={`text-xs font-medium capitalize ${stepColor}`}>{stepLabel}</p>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400">{account.warmupProgress || 0}% completo</span>
          </div>
          {remaining && (
            <p className="text-xs text-gray-500 mt-1">
              <Clock className="w-2.5 h-2.5 inline mr-1" />
              {remaining}
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-400 transition-all duration-300"
            style={{ width: `${account.warmupProgress || 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ workerStatus, liveLog, accountUpdates }) {
  const [logs, setLogs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);

  const warmingAccounts = accounts.filter((a) => a.warmupStatus === 'warming');
  const readyAccounts = accounts.filter((a) => a.status === 'ready_for_ads');
  const totalAccounts = accounts.length;

  // Carrega contas e logs iniciais
  useEffect(() => {
    async function load() {
      try {
        const [accts, logs] = await Promise.all([
          api.getAccounts(),
          api.getLogs(30),
        ]);
        setAccounts(accts);
        setLogs(logs);
      } catch (e) {
        toast.error('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Atualiza conta quando há mudança em tempo real
  useEffect(() => {
    if (accountUpdates) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === accountUpdates.id ? { ...a, ...accountUpdates } : a))
      );
    }
  }, [accountUpdates]);

  // Adiciona log em tempo real
  useEffect(() => {
    if (liveLog) {
      setLogs((prev) => [liveLog, ...prev].slice(0, 30));
    }
  }, [liveLog]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>

      {loading ? (
        <div className="card text-center py-8">
          <p className="text-gray-400">Carregando...</p>
        </div>
      ) : (
        <>
          {/* Estatísticas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card bg-gray-800/50">
              <p className="text-xs text-gray-500 uppercase">Total</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{totalAccounts}</p>
            </div>
            <div className="card bg-gray-800/50">
              <p className="text-xs text-gray-500 uppercase">Aquecendo</p>
              <p className="text-2xl font-bold text-yellow-400 mt-1">{warmingAccounts.length}</p>
            </div>
            <div className="card bg-gray-800/50">
              <p className="text-xs text-gray-500 uppercase">Prontos</p>
              <p className="text-2xl font-bold text-green-400 mt-1">{readyAccounts.length}</p>
            </div>
            <div className="card bg-gray-800/50">
              <p className="text-xs text-gray-500 uppercase">Taxa</p>
              <p className="text-2xl font-bold text-brand-400 mt-1">
                {totalAccounts > 0 ? Math.round((readyAccounts.length / totalAccounts) * 100) : 0}%
              </p>
            </div>
          </div>

          {/* Contas aquecendo agora */}
          {warmingAccounts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                🔥 Aquecendo Agora ({warmingAccounts.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {warmingAccounts.map((a) => (
                  <WarmingAccountCard key={a.id} account={a} />
                ))}
              </div>
            </section>
          )}

          {/* Próximas a terminar */}
          {warmingAccounts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                ⏰ Próximas a Terminar (próximos 5 minutos)
              </h2>
              <div className="space-y-2">
                {warmingAccounts
                  .filter((a) => {
                    if (!a.warmupStartTime || a.warmupProgress < 95) return false;
                    const elapsed = Date.now() - new Date(a.warmupStartTime).getTime();
                    const days = elapsed / (1000 * 60 * 60 * 24);
                    return days > 20.5; // Próximos a completar os 21 dias
                  })
                  .slice(0, 5)
                  .map((a) => (
                    <div key={a.id} className="card bg-green-900/20 border border-green-800/30 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-green-400">{a.email}</p>
                        <p className="text-xs text-gray-400">{a.warmupProgress}% completo</p>
                      </div>
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    </div>
                  ))}
                {warmingAccounts.filter((a) => a.warmupProgress > 95).length === 0 && (
                  <p className="text-sm text-gray-600 py-4 text-center">Nenhuma conta terminando em breve</p>
                )}
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
        </>
      )}
    </div>
  );
}
