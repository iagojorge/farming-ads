import { useState, useEffect } from 'react';
import { Shield, RefreshCw, Play, CheckCircle, AlertTriangle, Square, Key, Mail, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function Security() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(false);

  const TARGET_EMAIL = 'dime@agencia-titan.com';
  const TARGET_PASSWORD = '#ytskiro2026';

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const all = await api.getAccounts();
      setAccounts(all);
    } catch (err) {
      toast.error('Erro ao carregar contas: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();

    const token = localStorage.getItem('token');
    if (!token) return;
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('recovery-status', (e) => {
      const data = JSON.parse(e.data);
      setRunning(data.isRunning);
    });

    es.addEventListener('account-update', (e) => {
      const data = JSON.parse(e.data);
      setAccounts((prev) =>
        prev.map((a) => (a.id === data.id ? { ...a, ...data } : a))
      );
    });

    return () => es.close();
  }, []);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === accounts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(accounts.map((a) => a.id)));
    }
  };

  const handleRun = async (ids) => {
    if (ids.length === 0) {
      toast.error('Nenhuma conta selecionada');
      return;
    }
    setRunning(true);
    try {
      await api.updateRecoveryEmail(ids);
      toast.success(`Segurança iniciada para ${ids.length} conta(s)!`);
    } catch (err) {
      toast.error('Erro: ' + err.message);
    }
  };

  const handleStop = async () => {
    try {
      await api.stopRecoveryEmail();
      toast.info('Parando...');
      setRunning(false);
    } catch (err) {
      toast.error('Erro ao parar: ' + err.message);
    }
  };

  const emailOk = accounts.filter((a) => a.recoveryEmail === TARGET_EMAIL).length;
  const passwordOk = accounts.filter((a) => a.password === TARGET_PASSWORD).length;
  const blockedCount = accounts.filter((a) => a.status === 'desativada').length;
  const pendingCount = accounts.filter((a) => a.status !== 'desativada' && (a.recoveryEmail !== TARGET_EMAIL || a.password !== TARGET_PASSWORD)).length;

  const getTargetIds = () => {
    if (selected.size > 0) return Array.from(selected);
    return accounts
      .filter((a) => a.status !== 'desativada' && (a.recoveryEmail !== TARGET_EMAIL || a.password !== TARGET_PASSWORD))
      .map((a) => a.id);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-yellow-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-100">Segurança</h1>
            <p className="text-sm text-gray-500">
              Trocar email de recuperação + senha das contas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAccounts}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-100 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => handleRun(getTargetIds())}
            disabled={running || getTargetIds().length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" />
            {running ? 'Rodando...' : `Executar (${getTargetIds().length})`}
          </button>

          {running && (
            <button
              onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Square className="w-4 h-4" />
              Parar
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-sm text-gray-500">Total de Contas</div>
          <div className="text-2xl font-bold text-gray-100">{accounts.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-green-800/40 p-4">
          <div className="flex items-center gap-1 text-sm text-green-400">
            <Mail className="w-3 h-3" /> Email OK
          </div>
          <div className="text-2xl font-bold text-green-400">{emailOk}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-green-800/40 p-4">
          <div className="flex items-center gap-1 text-sm text-green-400">
            <Key className="w-3 h-3" /> Senha OK
          </div>
          <div className="text-2xl font-bold text-green-400">{passwordOk}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-yellow-800/40 p-4">
          <div className="text-sm text-yellow-400">Pendentes</div>
          <div className="text-2xl font-bold text-yellow-400">{pendingCount}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-red-800/40 p-4">
          <div className="flex items-center gap-1 text-sm text-red-400">
            <XCircle className="w-3 h-3" /> Bloqueadas
          </div>
          <div className="text-2xl font-bold text-red-400">{blockedCount}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <Shield className="w-12 h-12 text-gray-700" />
          <h3 className="text-gray-400 font-medium">Nenhuma conta cadastrada</h3>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div className="w-6">
              <input
                type="checkbox"
                checked={selected.size === accounts.length && accounts.length > 0}
                onChange={toggleAll}
                className="w-4 h-4 rounded accent-yellow-500 cursor-pointer"
              />
            </div>
            <div className="flex-1">Email da Conta</div>
            <div className="w-56">Email de Recuperação</div>
            <div className="w-20 text-center">Email</div>
            <div className="w-20 text-center">Senha</div>
            <div className="w-24 text-center">Status</div>
          </div>

          {accounts.map((account) => {
            const emailIsOk = account.recoveryEmail === TARGET_EMAIL;
            const pwIsOk = account.password === TARGET_PASSWORD;
            const isBlocked = account.status === 'desativada';
            return (
              <div
                key={account.id}
                className={`flex items-center gap-4 px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors cursor-pointer ${selected.has(account.id) ? 'bg-yellow-900/10' : ''} ${isBlocked ? 'opacity-60' : ''}`}
                onClick={() => toggleSelect(account.id)}
              >
                <div className="w-6">
                  <input
                    type="checkbox"
                    checked={selected.has(account.id)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded accent-yellow-500 cursor-pointer"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <span className={`text-sm truncate font-mono ${isBlocked ? 'text-red-400' : 'text-gray-200'}`}>{account.email}</span>
                </div>

                <div className="w-56">
                  <span className={`text-xs font-mono ${emailIsOk ? 'text-green-400' : 'text-yellow-400'}`}>
                    {account.recoveryEmail || '(não definido)'}
                  </span>
                </div>

                <div className="w-20 text-center">
                  {emailIsOk ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-900/50 text-green-400">
                      <CheckCircle className="w-3 h-3" /> OK
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-900/50 text-yellow-400">
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                </div>

                <div className="w-20 text-center">
                  {pwIsOk ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-900/50 text-green-400">
                      <CheckCircle className="w-3 h-3" /> OK
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-900/50 text-yellow-400">
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="w-24 text-center">
                  {isBlocked ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-900/50 text-red-400">
                      <XCircle className="w-3 h-3" /> Bloqueada
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-500">
                      Ativa
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-lg p-4">
        <h3 className="text-sm font-medium text-yellow-300 mb-2">Sobre Segurança</h3>
        <ul className="text-xs text-yellow-400/80 space-y-1 list-disc list-inside">
          <li>O sistema faz login, troca o email de recuperação para <code>{TARGET_EMAIL}</code> e a senha para a senha padrão</li>
          <li>Ambas as tarefas rodam na mesma sessão do browser (login único)</li>
          <li>Após a troca, os dados são atualizados automaticamente no sistema</li>
          <li>Contas já com email e senha corretos são puladas automaticamente</li>
          <li>Múltiplas contas rodam em paralelo para mais velocidade</li>
        </ul>
      </div>
    </div>
  );
}
