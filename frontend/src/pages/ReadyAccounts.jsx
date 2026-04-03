import { useState, useEffect } from 'react';
import { CheckCircle, Download, RefreshCw, Package } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function ReadyAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const all = await api.getAccounts();
      setAccounts(all.filter((a) => a.status === 'ready_for_ads'));
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

  const toggleAll = () => {
    if (selected.size === accounts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(accounts.map((a) => a.id)));
    }
  };

  const handleExport = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : accounts.map((a) => a.id);
    if (ids.length === 0) {
      toast.error('Nenhuma conta para exportar');
      return;
    }

    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/accounts/export-cookies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ accountIds: ids }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao exportar');
      }

      const data = await res.json();

      // Gera arquivo JSON para download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contas_prontas_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      // Também gera arquivo Netscape (formato de cookies para extensões)
      const netscapeContent = generateNetscapeCookies(data.accounts);
      const blobNs = new Blob([netscapeContent], { type: 'text/plain' });
      const urlNs = URL.createObjectURL(blobNs);
      const aNs = document.createElement('a');
      aNs.href = urlNs;
      aNs.download = `cookies_${new Date().toISOString().slice(0, 10)}.txt`;
      aNs.click();
      URL.revokeObjectURL(urlNs);

      toast.success(`✅ ${data.total} conta(s) exportada(s)!`);
    } catch (err) {
      toast.error('Erro ao exportar: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const generateNetscapeCookies = (accounts) => {
    let content = '# Netscape HTTP Cookie File\n';
    content += '# Exported by Farming Ads\n\n';

    for (const account of accounts) {
      content += `# === ${account.email} ===\n`;
      if (!account.cookies || account.cookies.length === 0) {
        content += '# (sem cookies disponíveis)\n\n';
        continue;
      }
      for (const cookie of account.cookies) {
        const httpOnly = cookie.httpOnly ? 'TRUE' : 'FALSE';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expires = cookie.expires ? Math.floor(cookie.expires) : 0;
        content += `${cookie.domain || '.google.com'}\t${httpOnly}\t${cookie.path || '/'}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}\n`;
      }
      content += '\n';
    }

    return content;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-green-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-100">Contas Prontas</h1>
            <p className="text-sm text-gray-500">
              {accounts.length} conta(s) aquecida(s) e prontas para Google Ads
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
            onClick={handleExport}
            disabled={exporting || accounts.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exportando...' : selected.size > 0 ? `Exportar (${selected.size})` : 'Exportar Tudo'}
          </button>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <Package className="w-12 h-12 text-gray-700" />
          <h3 className="text-gray-400 font-medium">Nenhuma conta pronta ainda</h3>
          <p className="text-gray-600 text-sm max-w-xs">
            Contas aparecem aqui após completar {3} dias de aquecimento.
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          {/* Header da tabela */}
          <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div className="w-6">
              <input
                type="checkbox"
                checked={selected.size === accounts.length && accounts.length > 0}
                onChange={toggleAll}
                className="w-4 h-4 rounded accent-green-500 cursor-pointer"
              />
            </div>
            <div className="flex-1">Email</div>
            <div className="w-32">Proxy</div>
            <div className="w-24 text-center">Dias</div>
            <div className="w-40 text-center">Concluído em</div>
            <div className="w-28 text-center">Cookies</div>
          </div>

          {/* Linhas */}
          {accounts.map((account) => (
            <div
              key={account.id}
              className={`flex items-center gap-4 px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors cursor-pointer ${selected.has(account.id) ? 'bg-green-900/10' : ''}`}
              onClick={() => toggleSelect(account.id)}
            >
              <div className="w-6">
                <input
                  type="checkbox"
                  checked={selected.has(account.id)}
                  onChange={() => {}}
                  className="w-4 h-4 rounded accent-green-500 cursor-pointer"
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-gray-200 truncate font-mono">{account.email}</span>
                </div>
              </div>

              <div className="w-32">
                {account.proxy ? (
                  <span className="text-xs text-gray-400 truncate block">
                    {account.proxy.split(':')[0]}
                  </span>
                ) : (
                  <span className="text-xs text-gray-700">Sem proxy</span>
                )}
              </div>

              <div className="w-24 text-center">
                <span className="text-sm font-bold text-green-400">
                  {account.warmupDaysDone || 0}/3
                </span>
              </div>

              <div className="w-40 text-center">
                <span className="text-xs text-gray-400">
                  {account.lastWarmupAt
                    ? new Date(account.lastWarmupAt).toLocaleDateString('pt-BR')
                    : '—'}
                </span>
              </div>

              <div className="w-28 text-center">
                <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-400">
                  No perfil
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      {accounts.length > 0 && (
        <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-300 mb-2">ℹ️ Sobre a Exportação</h3>
          <ul className="text-xs text-blue-400/80 space-y-1 list-disc list-inside">
            <li>Exporta 2 arquivos: <strong>JSON completo</strong> e <strong>cookies.txt (Netscape)</strong></li>
            <li>Os cookies ficam salvos no perfil de cada conta em <code>data/profiles/</code></li>
            <li>Formato Netscape é compatível com extensões de importação de cookies</li>
            <li>Selecione contas específicas ou exporte todas de uma vez</li>
          </ul>
        </div>
      )}
    </div>
  );
}
