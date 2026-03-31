import { useState, useEffect } from 'react';
import { Trash2, Play, Square, RefreshCw, CheckSquare, Square as SquareIcon, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

// ── Badge de status ────────────────────────────────────────────
const STATUS_CONFIG = {
  pending:      { label: 'Pendente',  color: 'bg-gray-700 text-gray-300' },
  'logging-in': { label: 'Logando…', color: 'bg-blue-900 text-blue-200' },
  completed:    { label: 'Pronto',    color: 'bg-green-900 text-green-300' },
  error:        { label: 'Erro',      color: 'bg-red-900 text-red-300' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ── Componente principal ───────────────────────────────────────
export default function Accounts({ loginStatus }) {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [proxy, setProxy] = useState('');
  const [csvText, setCsvText] = useState('');
  const [addMode, setAddMode] = useState('single'); // 'single' | 'batch'
  const [loading, setLoading] = useState(false);

  const loginRunning = loginStatus?.isRunning ?? false;
  const activeJobs = loginStatus?.jobs ?? [];
  const jobMap = Object.fromEntries(activeJobs.map((j) => [j.id, j]));

  useEffect(() => { loadAccounts(); }, []);

  // Recarrega lista quando o worker de login termina
  useEffect(() => {
    if (!loginRunning) loadAccounts();
  }, [loginRunning]);

  async function loadAccounts() {
    try {
      setAccounts(await api.getAccounts());
    } catch (e) {
      toast.error(`Erro ao carregar contas: ${e.message}`);
    }
  }

  // ── Adicionar conta única + iniciar login ──────────────────
  async function handleAddSingle() {
    if (!email || !password) return toast.error('Email e senha são obrigatórios');
    if (!proxy) return toast.error('Proxy é obrigatório (host:port:user:pass)');
    setLoading(true);
    try {
      const account = await api.addAccount(email, password, proxy);
      setAccounts((prev) => [...prev, account]);
      setEmail('');
      setPassword('');
      setProxy('');
      toast.success('Conta adicionada — iniciando login automático');
      await api.startLogin([account.id]);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Adicionar lote + iniciar login em todos ────────────────
  async function handleAddBatch() {
    const batch = csvText
      .trim().split('\n').filter((l) => l.trim())
      .map((line) => {
        const parts = line.split(',').map((s) => s.trim());
        return { email: parts[0], password: parts[1], proxy: parts[2] || '' };
      })
      .filter((a) => a.email && a.password);

    if (batch.length === 0) return toast.error('Nenhuma entrada válida. Use formato: email,senha,proxy');
    setLoading(true);
    try {
      const added = await api.addAccountsBatch(batch);
      setAccounts((prev) => [...prev, ...added]);
      setCsvText('');
      toast.success(`${added.length} conta(s) adicionada(s) — iniciando login automático`);
      await api.startLogin(added.map((a) => a.id));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Ações de login ────────────────────────────────────────
  async function handleStartLogin() {
    const ids = selected.size > 0 ? [...selected] : null;
    try {
      await api.startLogin(ids);
      toast.info(ids ? `Login iniciado para ${ids.length} conta(s) selecionada(s)` : 'Login iniciado para todas as contas pendentes');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleStopLogin() {
    try {
      await api.stopLogin();
      toast.info('Login interrompido');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover esta conta?')) return;
    try {
      await api.deleteAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) {
      toast.error(e.message);
    }
  }

  // ── Seleção ───────────────────────────────────────────────
  function toggleSelect(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    setSelected(selected.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.id)));
  }

  const completed = accounts.filter((a) => a.warmupStatus === 'warmed' || a.status === 'completed').length;
  const warming   = accounts.filter((a) => a.warmupStatus === 'warming').length;
  const pending   = accounts.filter((a) => a.status === 'pending' || a.status === 'error').length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Contas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {accounts.length} total &middot;
            <span className="text-green-400"> {completed} aquecidas</span> &middot;
            <span className="text-orange-400"> {warming} aquecendo</span> &middot;
            {pending} pendentes
          </p>
        </div>
        <button onClick={loadAccounts} className="btn-secondary text-xs">
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Formulário de adicionar */}
      <div className="card p-5 space-y-4">
        <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit">
          {['single', 'batch'].map((m) => (
            <button
              key={m}
              onClick={() => setAddMode(m)}
              className={`px-4 py-1.5 text-sm rounded transition ${addMode === m ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {m === 'single' ? 'Uma conta' : 'Lote (CSV)'}
            </button>
          ))}
        </div>

        {addMode === 'single' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="email" placeholder="email@gmail.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input" disabled={loading || loginRunning} />
              <input type="password" placeholder="Senha" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input" disabled={loading || loginRunning} />
              <input type="text" placeholder="host:port:user:pass" value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSingle()}
                className="input font-mono text-xs" disabled={loading || loginRunning} />
            </div>
            <button onClick={handleAddSingle}
              disabled={loading || loginRunning || !email || !password || !proxy}
              className="btn-primary w-full">
              <Play className="w-4 h-4" />
              Adicionar e Fazer Login Automático
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Uma conta por linha &rarr; <span className="font-mono text-gray-400">email,senha,host:port:user:pass</span>
            </p>
            <textarea
              placeholder={"email1@gmail.com,senha1,181.215.24.56:15324:user1:pass1\nemail2@gmail.com,senha2,200.10.20.30:8080:user2:pass2"}
              value={csvText} onChange={(e) => setCsvText(e.target.value)}
              rows={6} className="input font-mono text-xs resize-none"
              disabled={loading || loginRunning} />
            <button onClick={handleAddBatch}
              disabled={loading || loginRunning || !csvText.trim()}
              className="btn-primary w-full">
              <Play className="w-4 h-4" />
              Adicionar Lote e Fazer Login em Todos
            </button>
          </div>
        )}
      </div>

      {/* Barra de ações na lista */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {loginRunning ? (
            <>
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-sm text-blue-300 flex-1">
                Logando — {activeJobs.length} conta(s) em andamento
              </span>
              <button onClick={handleStopLogin} className="btn-danger text-xs">
                <Square className="w-3 h-3" />
                Parar Login
              </button>
            </>
          ) : (
            <>
              {selected.size > 0 && (
                <span className="text-xs text-gray-400">{selected.size} selecionada(s)</span>
              )}
              <button
                onClick={handleStartLogin}
                disabled={pending === 0 && selected.size === 0}
                className="btn-secondary text-xs"
              >
                <Play className="w-3 h-3" />
                {selected.size > 0
                  ? `Logar Selecionadas (${selected.size})`
                  : `Logar Todas Pendentes (${pending})`}
              </button>
              {warming > 0 && (
                <button
                  onClick={async () => {
                    try {
                      await api.triggerWarmup();
                      toast.success('Ciclo de aquecimento iniciado!');
                    } catch (e) { toast.error(e.message); }
                  }}
                  className="btn-secondary text-xs"
                >
                  <Flame className="w-3 h-3 text-orange-400" />
                  Aquecer Agora ({warming})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Tabela */}
      {accounts.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 w-8">
                  <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-100 flex">
                    {selected.size === accounts.length
                      ? <CheckSquare className="w-4 h-4 text-brand-400" />
                      : <SquareIcon className="w-4 h-4" />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Proxy</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Perfil</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => {
                const job = jobMap[acc.id];
                const effectiveStatus = job ? 'logging-in' : (acc.warmupStatus === 'warming' || acc.warmupStatus === 'warmed') ? acc.warmupStatus : acc.status;
                return (
                  <tr key={acc.id} className={`border-b border-gray-800 last:border-0 hover:bg-gray-800/30 ${selected.has(acc.id) ? 'bg-brand-950/30' : ''}`}>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(acc.id)} className="text-gray-400 hover:text-gray-100 flex">
                        {selected.has(acc.id)
                          ? <CheckSquare className="w-4 h-4 text-brand-400" />
                          : <SquareIcon className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-100 font-medium">{acc.email}</div>
                      {job && <div className="text-xs text-blue-300 mt-0.5">{job.status}</div>}
                      {!job && acc.warmupStatus === 'warming' && (
                        <WarmupProgress account={acc} />
                      )}
                      {!job && acc.error && (
                        <div className="text-xs text-red-400 mt-0.5 truncate max-w-xs" title={acc.error}>
                          {acc.error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-500 font-mono truncate max-w-[160px] inline-block" title={acc.proxy}>
                        {acc.proxy ? `${acc.proxy.split(':')[0]}:${acc.proxy.split(':')[1]}` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-500 font-mono">
                      {acc.profileId ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={effectiveStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDelete(acc.id)}
                        className="p-1.5 hover:bg-red-900/50 hover:text-red-300 text-gray-600 rounded transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {accounts.length === 0 && (
        <div className="card text-center py-16 text-gray-600 text-sm">
          Nenhuma conta adicionada ainda
        </div>
      )}
    </div>
  );
}

