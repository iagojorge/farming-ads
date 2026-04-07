import { useState, useEffect } from 'react';
import { Shield, RefreshCw, Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function Security() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(false);

  const TARGET_EMAIL = 'iagojorge@agencia-titan.com';

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
  }, []);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (filtered) => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
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
      toast.success(`Troca de email iniciada para ${ids.length} conta(s)!`);
    } catch (err) {
      toast.error('Erro: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  const needsUpdate = accounts.filter((a) => a.recoveryEmail !== TARGET_EMAIL);
  const alreadyOk = accounts.filter((a) => a.recoveryEmail === TARGET_EMAIL);

  const getTargetAccounts = () => {
    if (selected.size > 0) {
      return accounts.filter((a) => selected.has(a.id) && a.recoveryEmail !== TARGET_EMAIL);
    }
    return needsUpdate;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-yellow-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-100">Segurança</h1>
            <p className="text-sm text-gray-500">
              Trocar email de recuperação das contas para <span className="text-yellow-400 font-mono">{TARGET_EMAIL}</span>
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
            onClick={() => handleRun(getTargetAccounts().map((a) => a.id))}
            disabled={running || getTargetAccounts().length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" />
            {running ? 'Rodando...' : `Trocar Email (${getTargetAccounts().length})`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-sm text-gray-500">Total de Contas</div>
          <div className="text-2xl font-bold text-gray-100">{accounts.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-green-800/40 p-4">
          <div className="text-sm text-green-400">Email Correto</div>
          <div className="text-2xl font-bold text-green-400">{alreadyOk.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-yellow-800/40 p-4">
          <div className="text-sm text-yellow-400">Precisa Trocar</div>
          <div className="text-2xl font-bold text-yellow-400">{needsUpdate.length}</div>
        </div>
      </div>

      {/* Tabela */}
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
                onChange={() => toggleAll(accounts)}
                className="w-4 h-4 rounded accent-yellow-500 cursor-pointer"
              />
            </div>
            <div className="flex-1">Email</div>
            <div className="w-64">Email de Recuperação Atual</div>
            <div className="w-28 text-center">Status</div>
          </div>

          {accounts.map((account) => {
            const isOk = account.recoveryEmail === TARGET_EMAIL;
            return (
              <div
                key={account.id}
                className={`flex items-center gap-4 px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors cursor-pointer ${selected.has(account.id) ? 'bg-yellow-900/10' : ''}`}
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
                  <span className="text-sm text-gray-200 truncate font-mono">{account.email}</span>
                </div>

                <div className="w-64">
                  <span className={`text-xs font-mono ${isOk ? 'text-green-400' : 'text-yellow-400'}`}>
                    {account.recoveryEmail || '(não definido)'}
                  </span>
                </div>

                <div className="w-28 text-center">
                  {isOk ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-900/50 text-green-400">
                      <CheckCircle className="w-3 h-3" /> OK
                    </span>
                  ) : account.recoveryEmail ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-900/50 text-yellow-400">
                      <AlertTriangle className="w-3 h-3" /> Trocar
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-900/50 text-red-400">
                      <XCircle className="w-3 h-3" /> Vazio
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-lg p-4">
        <h3 className="text-sm font-medium text-yellow-300 mb-2">⚠️ Sobre a Troca de Email</h3>
        <ul className="text-xs text-yellow-400/80 space-y-1 list-disc list-inside">
          <li>O sistema faz login em cada conta e altera o email de recuperação automaticamente</li>
          <li>O Google pedirá um código de verificação no novo email — não é necessário validar</li>
          <li>Após a troca, o campo <code>recoveryEmail</code> é atualizado no sistema para o login funcionar</li>
          <li>Contas já com o email correto são ignoradas automaticamente</li>
        </ul>
      </div>
    </div>
  );
}
