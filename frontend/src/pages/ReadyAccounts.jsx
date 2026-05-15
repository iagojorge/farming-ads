import { useState, useEffect } from 'react';
import { CheckCircle, Download, RefreshCw, Package, Zap, Square, Chrome, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function ReadyAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [runningAds, setRunningAds] = useState(false);
  const [runningMCC, setRunningMCC] = useState(false);
  const [openingChrome, setOpeningChrome] = useState(false);
  const [stoppingChrome, setStoppingChrome] = useState(false);
  const [chromeRunning, setChromeRunning] = useState(false);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const [all, warmupStatus] = await Promise.all([
        api.getAccounts(),
        api.getWarmupStatus(),
      ]);
      setAccounts(all.filter((a) => a.status === 'ready_for_ads'));
      setRunningAds(!!warmupStatus?.isGoogleAdsRunning);
      setRunningMCC(!!warmupStatus?.isMCCRunning);
      setChromeRunning(!!warmupStatus?.isOpenChromeRunning);
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
      const data = await api.exportCookies(ids);

      for (const account of data.accounts) {
        const fileName = `${sanitizeEmailForFileName(account.email, account.id)}.txt`;
        const txtContent = generateExportTxt(account);
        downloadTextFile(txtContent, fileName);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      toast.success(`✅ ${data.total} conta(s) exportada(s)!`);
    } catch (err) {
      toast.error('Erro ao exportar: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleOpenChrome = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : [];
    if (ids.length === 0) {
      toast.error('Selecione ao menos 1 conta para abrir no Chrome');
      return;
    }

    setOpeningChrome(true);
    try {
      await api.openChrome(ids);
      setChromeRunning(true);
      toast.success(`Chrome aberto para ${ids.length} conta(s)`);
    } catch (err) {
      toast.error('Erro ao abrir Chrome: ' + err.message);
    } finally {
      setOpeningChrome(false);
    }
  };

  const [deletingSelected, setDeletingSelected] = useState(false);

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Remover ${selected.size} conta(s) selecionada(s)?`)) return;
    setDeletingSelected(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => api.deleteAccount(id)));
      setAccounts((prev) => prev.filter((a) => !ids.includes(a.id)));
      setSelected(new Set());
      toast.success(`${ids.length} conta(s) removida(s)`);
    } catch (err) {
      toast.error('Erro ao remover: ' + err.message);
    } finally {
      setDeletingSelected(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Remover esta conta?')) return;
    try {
      await api.deleteAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch (err) {
      toast.error('Erro ao remover: ' + err.message);
    }
  };

  const handleStopChrome = async () => {
    setStoppingChrome(true);
    try {
      await api.stopOpenChrome();
      setChromeRunning(false);
      toast.info('Solicitação para fechar os Chromes enviada');
    } catch (err) {
      toast.error('Erro ao fechar Chrome: ' + err.message);
    } finally {
      setStoppingChrome(false);
    }
  };

  const sanitizeEmailForFileName = (email, fallback = 'conta') => {
    const safe = (email || fallback)
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[. ]+$/g, '');
    return safe || fallback;
  };

  const downloadTextFile = (content, fileName) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const generateExportTxt = (account) => {
    let content = '==========================================================\n';
    content += '  FARMING ADS - Conta Pronta para Google Ads\n';
    content += `  Exportado em: ${new Date().toLocaleString('pt-BR')}\n`;
    content += `  Conta: ${account.email}\n`;
    content += '==========================================================\n\n';

    content += '----------------------------------------------------------\n';
    content += `Email:    ${account.email}\n`;
    content += `Senha:    ${account.password}\n`;
    content += `Email de Recuperação: ${account.recoveryEmail || 'Não configurado'}\n`;
    content += `Token 2FA (TOTP): ${account.totpSecret || 'Não configurado'}\n`;
    content += `Proxy:    ${account.proxy || 'Nenhum'}\n`;
    content += `API Key:  ${account.googleAdsApiKey || 'Não gerada'}\n`;
    content += `Ads ID:   ${account.googleAdsAccountId || 'Não capturado'}\n`;
    content += `Dias:     ${account.warmupDaysDone}/3\n`;
    content += `Concluído: ${account.completedAt ? new Date(account.completedAt).toLocaleString('pt-BR') : '-'}\n`;
    content += `Cookies:  ${account.cookiesAvailable ? account.cookies.length + ' cookies' : 'Não disponível'}\n`;
    content += '----------------------------------------------------------\n';

    if (account.cookies && account.cookies.length > 0) {
      content += '\n# Netscape HTTP Cookie File\n';
      for (const cookie of account.cookies) {
        const httpOnly = cookie.httpOnly ? 'TRUE' : 'FALSE';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expires = cookie.expires ? Math.floor(cookie.expires) : 0;
        content += `${cookie.domain || '.google.com'}\t${httpOnly}\t${cookie.path || '/'}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}\n`;
      }
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

          {(() => {
            const noKeyIds = selected.size > 0
              ? accounts.filter((a) => selected.has(a.id)).map((a) => a.id)
              : accounts.map((a) => a.id);
            return noKeyIds.length > 0 && (
              <button
                onClick={async () => {
                  setRunningAds(true);
                  try {
                    await api.runGoogleAds(noKeyIds);
                    toast.success(`Google Ads iniciado para ${noKeyIds.length} conta(s)!`);
                  } catch (err) {
                    toast.error('Erro: ' + err.message);
                  } finally {
                    setRunningAds(false);
                  }
                }}
                disabled={runningAds}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Zap className="w-4 h-4" />
                {runningAds ? 'Rodando...' : `Google Ads (${noKeyIds.length})`}
              </button>
            );
          })()}

          {runningAds && (
            <button
              onClick={async () => {
                try {
                  await api.stopGoogleAds();
                  toast.info('Parando Google Ads...');
                  setRunningAds(false);
                } catch (err) {
                  toast.error('Erro: ' + err.message);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Square className="w-4 h-4" />
              Parar
            </button>
          )}

          {/* Botão MCC */}
          {(() => {
            const mccIds = selected.size > 0
              ? accounts.filter((a) => selected.has(a.id)).map((a) => a.id)
              : accounts.map((a) => a.id);
            return mccIds.length > 0 && (
              <button
                onClick={async () => {
                  setRunningMCC(true);
                  try {
                    await api.runMCC(mccIds);
                    toast.success(`MCC iniciado para ${mccIds.length} conta(s)!`);
                  } catch (err) {
                    toast.error('Erro: ' + err.message);
                  } finally {
                    setRunningMCC(false);
                  }
                }}
                disabled={runningMCC}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Users className="w-4 h-4" />
                {runningMCC ? 'Rodando...' : `MCC (${mccIds.length})`}
              </button>
            );
          })()}

          {runningMCC && (
            <button
              onClick={async () => {
                try {
                  await api.stopMCC();
                  toast.info('Parando MCC...');
                  setRunningMCC(false);
                } catch (err) {
                  toast.error('Erro: ' + err.message);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Square className="w-4 h-4" />
              Parar MCC
            </button>
          )}

          <button
            onClick={handleOpenChrome}
            disabled={openingChrome || chromeRunning || selected.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Chrome className="w-4 h-4" />
            {openingChrome ? 'Abrindo Chrome...' : `Abrir Chrome${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>

          {chromeRunning && (
            <button
              onClick={handleStopChrome}
              disabled={stoppingChrome}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Square className="w-4 h-4" />
              {stoppingChrome ? 'Parando Chrome...' : 'Parar Chrome'}
            </button>
          )}

          {selected.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deletingSelected}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {deletingSelected ? 'Removendo...' : `Excluir (${selected.size})`}
            </button>
          )}

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
            <div className="w-28 text-center">Ads ID</div>
            <div className="w-28 text-center">API Key</div>
            <div className="w-40 text-center">Concluído em</div>
            <div className="w-10" />
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

              <div className="w-28 text-center">
                {account.googleAdsAccountId ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-900/50 text-blue-400 font-mono" title={account.googleAdsAccountId}>
                    {account.googleAdsAccountId}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-500">
                    —
                  </span>
                )}
              </div>

              <div className="w-28 text-center">
                {account.googleAdsApiKey ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-900/50 text-green-400" title={account.googleAdsApiKey}>
                    ✓ Gerada
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-500">
                    —
                  </span>
                )}
              </div>

              <div className="w-40 text-center">
                <span className="text-xs text-gray-400">
                  {account.lastWarmupAt
                    ? new Date(account.lastWarmupAt).toLocaleDateString('pt-BR')
                    : '—'}
                </span>
              </div>

              <div className="w-10 flex justify-end">
                <button
                  onClick={(e) => handleDelete(e, account.id)}
                  className="p-1.5 rounded hover:bg-red-900/50 hover:text-red-300 text-gray-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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
            <li>Exporta 1 arquivo <strong>.txt</strong> por conta, com nome do arquivo baseado no email</li>
            <li>Os cookies ficam salvos no perfil de cada conta em <code>data/profiles/</code></li>
            <li>Formato Netscape é compatível com extensões de importação de cookies</li>
            <li>Selecione contas específicas ou exporte todas de uma vez</li>
          </ul>
        </div>
      )}
    </div>
  );
}
