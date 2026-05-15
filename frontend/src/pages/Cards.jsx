import { useState, useEffect } from 'react';
import { CreditCard, Plus, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

const EMPTY_FORM = { bandeira: 'Visa', moeda: 'USD', numero_cartao: '', validade: '', cvc: '', status: 'Ativado' };

export default function Cards() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadCards = async () => {
    setLoading(true);
    try {
      const data = await api.getCards();
      setCards(data);
    } catch (err) {
      toast.error('Erro ao carregar cartões: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCards(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const card = await api.addCard(form);
      setCards((prev) => [...prev, card]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast.success('Cartão adicionado com sucesso!');
    } catch (err) {
      toast.error('Erro ao adicionar cartão: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, last4) => {
    if (!confirm(`Remover cartão terminado em ${last4}?`)) return;
    try {
      await api.deleteCard(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
      toast.success('Cartão removido.');
    } catch (err) {
      toast.error('Erro ao remover: ' + err.message);
    }
  };

  const statusColor = (s) => s === 'Ativado' ? 'text-green-400 bg-green-900/40' : 'text-red-400 bg-red-900/40';
  const brandColor = (b) => {
    if (b === 'Visa') return 'text-blue-400';
    if (b === 'Mastercard') return 'text-orange-400';
    return 'text-gray-400';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-brand-400" />
          <div>
            <h1 className="text-xl font-bold text-gray-100">Cartões</h1>
            <p className="text-sm text-gray-500">Gerencie os cartões usados no Google Ads</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadCards}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-100 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Adicionar Cartão
          </button>
        </div>
      </div>

      {/* Aviso de segurança */}
      <div className="flex items-start gap-2 bg-yellow-950/30 border border-yellow-800/40 rounded-lg p-3 text-xs text-yellow-400/90">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Por segurança, apenas os <strong>últimos 4 dígitos</strong> do número do cartão são exibidos. O número completo é armazenado de forma segura e nunca exposto na interface.</span>
      </div>

      {/* Formulário de adição */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-gray-900 rounded-xl border border-brand-800/40 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">Novo Cartão</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bandeira</label>
              <select
                value={form.bandeira}
                onChange={(e) => setForm((f) => ({ ...f, bandeira: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option>Visa</option>
                <option>Mastercard</option>
                <option>Amex</option>
                <option>Elo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Moeda</label>
              <select
                value={form.moeda}
                onChange={(e) => setForm((f) => ({ ...f, moeda: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option>USD</option>
                <option>BRL</option>
                <option>EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option>Ativado</option>
                <option>Desativado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Número do Cartão</label>
              <input
                required
                type="text"
                placeholder="0000 0000 0000 0000"
                value={form.numero_cartao}
                onChange={(e) => setForm((f) => ({ ...f, numero_cartao: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Validade (MM/AA)</label>
              <input
                required
                type="text"
                placeholder="01/28"
                value={form.validade}
                onChange={(e) => setForm((f) => ({ ...f, validade: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CVC</label>
              <input
                required
                type="text"
                placeholder="000"
                value={form.cvc}
                onChange={(e) => setForm((f) => ({ ...f, cvc: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-100 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <CreditCard className="w-12 h-12 text-gray-700" />
          <h3 className="text-gray-400 font-medium">Nenhum cartão cadastrado</h3>
          <p className="text-sm text-gray-600">Clique em "Adicionar Cartão" para começar</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_100px_90px_100px_44px] px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div>Número</div>
            <div>Bandeira</div>
            <div>Moeda</div>
            <div>Validade</div>
            <div>Status</div>
            <div></div>
          </div>
          {cards.map((card) => (
            <div
              key={card.id}
              className="grid grid-cols-[1fr_80px_100px_90px_100px_44px] items-center px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4 text-gray-600 flex-shrink-0" />
                <span className="text-sm font-mono text-gray-200">
                  •••• •••• •••• <span className="text-white font-semibold">{card.last4}</span>
                </span>
              </div>
              <div className={`text-sm font-medium ${brandColor(card.bandeira)}`}>{card.bandeira}</div>
              <div className="text-sm text-gray-400">{card.moeda}</div>
              <div className="text-sm font-mono text-gray-400">{card.validade}</div>
              <div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor(card.status)}`}>
                  {card.status}
                </span>
              </div>
              <button
                onClick={() => handleDelete(card.id, card.last4)}
                className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                title="Remover cartão"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="px-4 py-2 text-xs text-gray-600 border-t border-gray-800">
            {cards.length} cartão(ões) cadastrado(s) — {cards.filter(c => c.status === 'Ativado').length} ativo(s)
          </div>
        </div>
      )}
    </div>
  );
}
