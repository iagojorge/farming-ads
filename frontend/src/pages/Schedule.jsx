import { useState, useEffect } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

// Gera array com 12 períodos de 2h
const PERIODS = Array.from({ length: 12 }, (_, i) => {
  const startHour = i * 2;
  const endHour = (i + 1) * 2;
  const startTime = `${String(startHour).padStart(2, '0')}:00`;
  const endTime = `${String(endHour % 24).padStart(2, '0')}:00`;
  return {
    period: i,
    startTime,
    endTime,
    label: `${startTime} - ${endTime}`,
  };
});

function AllocateModal({ period, onClose, onAllocate, accounts, allocatedIds }) {
  const available = accounts.filter((a) => !allocatedIds.includes(a.id));

  if (available.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="card max-w-sm w-full">
          <h3 className="font-semibold text-gray-100 mb-3">Nenhuma conta disponível</h3>
          <p className="text-sm text-gray-400 mb-4">
            Todas as contas já estão alocadas em algum período.
          </p>
          <button
            className="btn-secondary w-full"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card max-w-md w-full max-h-96 flex flex-col">
        <h3 className="font-semibold text-gray-100 mb-4">
          Adicionar conta ao período {period.label}
        </h3>

        <div className="space-y-2 overflow-y-auto flex-1 pr-2 mb-4">
          {available.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-2 p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors group cursor-pointer"
              onClick={() => {
                onAllocate(account.id, period.period);
                onClose();
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-200 truncate">{account.email}</p>
                <p className="text-xs text-gray-500">
                  Status: <span className="text-gray-400 capitalize">{account.status}</span>
                </p>
              </div>
              <Plus className="w-4 h-4 text-gray-500 group-hover:text-brand-400 transition-colors" />
            </div>
          ))}
        </div>

        <button
          className="btn-secondary w-full"
          onClick={onClose}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PeriodCard({ period, accounts, onAddClick, onRemoveClick }) {
  const isFull = accounts.length >= 10;
  const isEmpty = accounts.length === 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-800">
        <h3 className="font-semibold text-gray-100">{period.label}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${
              isFull
                ? 'bg-red-900/50 text-red-400'
                : accounts.length > 5
                  ? 'bg-yellow-900/50 text-yellow-400'
                  : 'bg-gray-800 text-gray-400'
            }`}
          >
            {accounts.length}/10 contas
          </span>
        </div>
      </div>

      <div className="space-y-2 mb-4 min-h-32">
        {isEmpty ? (
          <div className="flex items-center justify-center h-32 bg-gray-800/30 rounded-lg border border-dashed border-gray-700">
            <p className="text-sm text-gray-500">Nenhuma conta alocada</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between gap-2 p-2 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-200 truncate">{account.email}</p>
                  <div className="flex gap-2 text-xs text-gray-500">
                    <span>{account.warmupStatus}</span>
                    {account.warmupProgress > 0 && (
                      <span>{account.warmupProgress}%</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveClick(account.id)}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-all"
                  title="Desalocar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className={`w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
          isFull
            ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
            : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-100'
        }`}
        onClick={onAddClick}
        disabled={isFull}
      >
        <Plus className="w-4 h-4" />
        {isFull ? 'Período cheio' : 'Adicionar conta'}
      </button>
    </div>
  );
}

export default function Schedule() {
  const [periods, setPeriods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [periodsData, accountsData] = await Promise.all([
        api.getSchedulePeriods(),
        api.getAccounts(),
      ]);
      setPeriods(periodsData);
      setAccounts(accountsData);
    } catch (err) {
      toast.error('Erro ao carregar dados: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAllocate(accountId, periodNum) {
    try {
      await api.allocateAccountToPeriod(accountId, periodNum);
      toast.success('Conta alocada com sucesso');
      await loadData();
      setShowModal(false);
    } catch (err) {
      toast.error('Erro ao alocar: ' + err.message);
    }
  }

  async function handleDeallocate(accountId) {
    try {
      await api.deallocateAccount(accountId);
      toast.success('Alocação removida');
      await loadData();
    } catch (err) {
      toast.error('Erro ao desalocar: ' + err.message);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  const allocatedIds = new Set(accounts
    .filter((a) => a.schedulePeriod !== null)
    .map((a) => a.id));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Agendamento de Contas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Distribua suas contas nos 12 períodos de 2 horas (máximo 10 contas por período).
            O warming iniciará 10 minutos antes do horário e finalizará 10 minutos antes do fim.
          </p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="card text-center py-12">
          <AlertCircle className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 mb-2">Nenhuma conta adicionada.</p>
          <p className="text-sm text-gray-600">Adicione contas na aba de Contas primeiro.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-100">Total de contas</p>
                <p className="text-2xl font-bold text-brand-400 mt-1">{accounts.length}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-100">Alocadas</p>
                <p className="text-2xl font-bold text-green-400 mt-1">{allocatedIds.size}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-100">Não alocadas</p>
                <p className="text-2xl font-bold text-yellow-400 mt-1">{accounts.length - allocatedIds.size}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PERIODS.map((period) => {
              const periodAccounts = accounts.filter((a) => a.schedulePeriod === period.period);

              return (
                <PeriodCard
                  key={period.period}
                  period={period}
                  accounts={periodAccounts}
                  onAddClick={() => {
                    setSelectedPeriod(period);
                    setShowModal(true);
                  }}
                  onRemoveClick={handleDeallocate}
                />
              );
            })}
          </div>
        </>
      )}

      {showModal && selectedPeriod && (
        <AllocateModal
          period={selectedPeriod}
          onClose={() => setShowModal(false)}
          onAllocate={handleAllocate}
          accounts={accounts}
          allocatedIds={Array.from(allocatedIds)}
        />
      )}
    </div>
  );
}
