import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Clock, Zap, CheckCircle, AlertTriangle, Flame, Users, TrendingUp, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';
import LogEntry from '../components/LogEntry.jsx';

const WARMUP_DAYS = 3;

// ── Gráfico de Donut SVG ──────────────────────────────────────
function DonutChart({ segments, size = 120, strokeWidth = 14 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Fundo */}
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f2937" strokeWidth={strokeWidth} />
      {total > 0 && segments.map((seg, i) => {
        const pct = seg.value / total;
        const dashLen = pct * circumference;
        const dashOffset = -offset * circumference;
        offset += pct;
        if (seg.value === 0) return null;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashLen} ${circumference - dashLen}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="transition-all duration-500"
          />
        );
      })}
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="fill-gray-100 text-lg font-bold">{total}</text>
      <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="fill-gray-500 text-[10px]">contas</text>
    </svg>
  );
}

// ── Barra de progresso por dia ────────────────────────────────
function DayDistributionBar({ accounts }) {
  const days = Array.from({ length: WARMUP_DAYS + 1 }, (_, i) => ({
    day: i,
    count: accounts.filter((a) => (a.warmupDaysDone || 0) === i && a.status === 'warming').length,
  }));
  const max = Math.max(1, ...days.map((d) => d.count));

  return (
    <div className="space-y-2">
      {days.map(({ day, count }) => (
        <div key={day} className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-14 text-right">Dia {day}/{WARMUP_DAYS}</span>
          <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(count > 0 ? 4 : 0, (count / max) * 100)}%`,
                background: day === WARMUP_DAYS ? '#22c55e' : day === 0 ? '#6b7280' : '#f59e0b',
              }}
            />
            {count > 0 && (
              <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-bold text-white drop-shadow">
                {count}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Card de conta aquecendo em tempo real ──────────────────────
function WarmingAccountCard({ account }) {
  const stepColor = {
    gmail: 'text-blue-400',
    youtube: 'text-red-400',
    globo: 'text-yellow-400',
    done: 'text-green-400',
    error: 'text-red-400',
  }[account.warmupCurrentStep] || 'text-gray-400';

  const stepLabel = {
    gmail: 'Gmail',
    youtube: 'YouTube',
    globo: 'Globo',
    done: 'Concluído',
    error: 'Erro',
  }[account.warmupCurrentStep] || account.warmupCurrentStep || '—';

  const daysDone = account.warmupDaysDone || 0;
  const progress = account.warmupProgress || Math.round((daysDone / WARMUP_DAYS) * 100);

  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-100 truncate">{account.email}</p>
          <div className="flex items-center gap-2 mt-1">
            {account.warmupStatus === 'warming' ? (
              <Zap className="w-3 h-3 text-yellow-400 animate-pulse" />
            ) : (
              <Clock className="w-3 h-3 text-gray-500" />
            )}
            <span className={`text-xs font-medium ${stepColor}`}>{stepLabel}</span>
            <span className="text-xs text-gray-600">•</span>
            <span className="text-xs text-gray-400">{daysDone}/{WARMUP_DAYS} dias</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-gray-200">{progress}%</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            account.warmupStatus === 'warming' ? 'bg-yellow-500' : progress >= 100 ? 'bg-green-500' : 'bg-orange-500'
          }`}
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
    </div>
  );
}

// ── Linha na tabela de todas as contas ────────────────────────
function AccountRow({ account }) {
  const daysDone = account.warmupDaysDone || 0;
  const progress = account.warmupProgress || Math.round((daysDone / WARMUP_DAYS) * 100);
  const isActive = account.warmupStatus === 'warming';

  const statusConfig = {
    pending:       { label: 'Pendente',      dot: 'bg-gray-500' },
    warming:       { label: 'Aquecendo',     dot: 'bg-orange-400' },
    ready_for_ads: { label: 'Pronto',        dot: 'bg-green-400' },
    checkpoint:    { label: 'Checkpoint',    dot: 'bg-yellow-400' },
    error:         { label: 'Erro',          dot: 'bg-red-400' },
    synced:        { label: 'Sincronizado',  dot: 'bg-emerald-400' },
  };
  const sc = statusConfig[account.status] || statusConfig.pending;

  return (
    <div className={`flex items-center gap-4 px-4 py-2.5 border-b border-gray-800/50 text-sm ${isActive ? 'bg-yellow-900/10' : 'hover:bg-gray-800/30'}`}>
      {/* Email */}
      <div className="flex-1 min-w-0">
        <span className="text-gray-200 truncate block">{account.email}</span>
      </div>

      {/* Status */}
      <div className="w-28 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${sc.dot} ${isActive ? 'animate-pulse' : ''}`} />
        <span className="text-xs text-gray-400">{sc.label}</span>
      </div>

      {/* Dias */}
      <div className="w-20 text-center">
        <span className={`text-xs font-bold ${progress >= 100 ? 'text-green-400' : daysDone > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
          {daysDone}/{WARMUP_DAYS}
        </span>
      </div>

      {/* Barra de progresso */}
      <div className="w-32">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                progress >= 100 ? 'bg-green-500' : progress > 0 ? 'bg-orange-500' : 'bg-gray-700'
              }`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 w-8 text-right">{progress}%</span>
        </div>
      </div>

      {/* Último aquecimento */}
      <div className="w-28 text-right">
        <span className="text-[11px] text-gray-600">
          {account.lastWarmupAt
            ? new Date(account.lastWarmupAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—'}
        </span>
      </div>
    </div>
  );
}

// ── Dashboard principal ───────────────────────────────────────
export default function Dashboard({ workerStatus, liveLog, accountUpdates }) {
  const [logs, setLogs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);

  const warmingNow = accounts.filter((a) => a.warmupStatus === 'warming');
  const allWarming = accounts.filter((a) => a.status === 'warming');
  const readyAccounts = accounts.filter((a) => a.status === 'ready_for_ads');
  const pendingAccounts = accounts.filter((a) => a.status === 'pending');
  const errorAccounts = accounts.filter((a) => a.status === 'error' || a.status === 'checkpoint');
  const totalAccounts = accounts.length;
  const accountsStarted = accounts.filter((a) => a.warmupDaysDone > 0 || a.status === 'warming' || a.status === 'ready_for_ads');

  useEffect(() => {
    async function load() {
      try {
        const [accts, logData] = await Promise.all([api.getAccounts(), api.getLogs(30)]);
        setAccounts(accts);
        setLogs(logData);
      } catch (e) {
        toast.error('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (accountUpdates) {
      setAccounts((prev) => prev.map((a) => (a.id === accountUpdates.id ? { ...a, ...accountUpdates } : a)));
    }
  }, [accountUpdates]);

  useEffect(() => {
    if (liveLog) {
      setLogs((prev) => [liveLog, ...prev].slice(0, 30));
    }
  }, [liveLog]);

  const donutSegments = [
    { label: 'Pendentes', value: pendingAccounts.length, color: '#6b7280' },
    { label: 'Aquecendo', value: allWarming.length, color: '#f59e0b' },
    { label: 'Prontas', value: readyAccounts.length, color: '#22c55e' },
    { label: 'Erro/Checkpoint', value: errorAccounts.length, color: '#ef4444' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const [accts, logData] = await Promise.all([api.getAccounts(), api.getLogs(30)]);
              setAccounts(accts);
              setLogs(logData);
            } catch (e) { toast.error('Erro'); }
            finally { setLoading(false); }
          }}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {loading ? (
        <div className="card text-center py-8">
          <p className="text-gray-400">Carregando...</p>
        </div>
      ) : (
        <>
          {/* ── Estatísticas + Donut ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Cards de stat */}
            <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-gray-500" />
                  <p className="text-xs text-gray-500 uppercase">Total</p>
                </div>
                <p className="text-2xl font-bold text-gray-100">{totalAccounts}</p>
              </div>
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <p className="text-xs text-gray-500 uppercase">Aquecendo</p>
                </div>
                <p className="text-2xl font-bold text-orange-400">{allWarming.length}</p>
                {warmingNow.length > 0 && (
                  <p className="text-[10px] text-yellow-400 mt-0.5 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> {warmingNow.length} ativa(s) agora
                  </p>
                )}
              </div>
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <p className="text-xs text-gray-500 uppercase">Prontas</p>
                </div>
                <p className="text-2xl font-bold text-green-400">{readyAccounts.length}</p>
              </div>
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4 text-gray-500" />
                  <p className="text-xs text-gray-500 uppercase">Pendentes</p>
                </div>
                <p className="text-2xl font-bold text-gray-400">{pendingAccounts.length}</p>
              </div>
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <p className="text-xs text-gray-500 uppercase">Erros</p>
                </div>
                <p className="text-2xl font-bold text-red-400">{errorAccounts.length}</p>
              </div>
              <div className="card bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-brand-400" />
                  <p className="text-xs text-gray-500 uppercase">Taxa Conclusão</p>
                </div>
                <p className="text-2xl font-bold text-brand-400">
                  {totalAccounts > 0 ? Math.round((readyAccounts.length / totalAccounts) * 100) : 0}%
                </p>
              </div>
            </div>

            {/* Donut chart */}
            <div className="card bg-gray-800/50 flex flex-col items-center justify-center">
              <DonutChart segments={donutSegments} />
              <div className="flex flex-wrap gap-3 mt-4 justify-center">
                {donutSegments.filter((s) => s.value > 0).map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-[10px] text-gray-400">{s.label} ({s.value})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Distribuição por dia de aquecimento ─────────── */}
          {allWarming.length > 0 && (
            <div className="card bg-gray-800/50">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                📊 Distribuição por Dia de Aquecimento
              </h2>
              <DayDistributionBar accounts={accounts} />
            </div>
          )}

          {/* ── Contas aquecendo em tempo real ────────────────── */}
          {warmingNow.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                🔥 Aquecendo Agora ({warmingNow.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {warmingNow.map((a) => (
                  <WarmingAccountCard key={a.id} account={a} />
                ))}
              </div>
            </section>
          )}

          {/* ── Status de todas as contas ──────────────────── */}
          {accountsStarted.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                📋 Progresso de Todas as Contas ({accountsStarted.length})
              </h2>
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-4 px-4 py-2.5 border-b border-gray-800 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex-1">Email</div>
                  <div className="w-28">Status</div>
                  <div className="w-20 text-center">Dias</div>
                  <div className="w-32">Progresso</div>
                  <div className="w-28 text-right">Último</div>
                </div>
                {/* Rows — ativos primeiro, depois por progresso desc */}
                {accountsStarted
                  .sort((a, b) => {
                    if (a.warmupStatus === 'warming' && b.warmupStatus !== 'warming') return -1;
                    if (b.warmupStatus === 'warming' && a.warmupStatus !== 'warming') return 1;
                    return (b.warmupProgress || 0) - (a.warmupProgress || 0);
                  })
                  .map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
              </div>
            </section>
          )}

          {/* ── Contas próximas a ficarem prontas ──────────── */}
          {(() => {
            const almostReady = allWarming.filter((a) => (a.warmupDaysDone || 0) >= WARMUP_DAYS - 1);
            if (almostReady.length === 0) return null;
            return (
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  ⏰ Quase Prontas ({almostReady.length})
                </h2>
                <div className="space-y-2">
                  {almostReady.slice(0, 10).map((a) => (
                    <div key={a.id} className="card bg-green-900/20 border border-green-800/30 flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-green-400">{a.email}</p>
                        <p className="text-xs text-gray-400">{a.warmupDaysDone || 0}/{WARMUP_DAYS} dias — {a.warmupProgress || 0}%</p>
                      </div>
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* ── Log recente ────────────────────────────────── */}
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
