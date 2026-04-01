import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setForm).catch(() => {});
  }, []);

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings(form);
      setForm(updated);
      toast.success('Configurações salvas');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form)
    return (
      <div className="p-6 text-gray-500 text-sm">Carregando configurações…</div>
    );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-100 mb-6">Configurações</h1>

      <form onSubmit={save} className="space-y-6">
        {/* AdsPower */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">AdsPower</h2>

          <div>
            <label className="label">URL da API local</label>
            <input
              className="input"
              value={form.adspowerUrl}
              onChange={(e) => set('adspowerUrl', e.target.value)}
              placeholder="http://local.adspower.net:50325"
            />
            <p className="text-xs text-gray-600 mt-1">
              Usado apenas para criar perfis no AdsPower ao final do processo.
            </p>
          </div>

          <div>
            <label className="label">API Key (opcional)</label>
            <input
              className="input"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder="Deixe em branco se não estiver configurado"
              type="password"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label">Grupo dos perfis</label>
            <input
              className="input"
              value={form.groupName || ''}
              onChange={(e) => set('groupName', e.target.value)}
              placeholder="Nome do grupo no AdsPower"
            />
            <p className="text-xs text-gray-600 mt-1">
              Perfis criados no AdsPower serão adicionados a este grupo.
            </p>
          </div>
        </section>

        {/* Aquecimento */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">Aquecimento</h2>
          <p className="text-xs text-gray-500">
            Browsers simultâneos durante o ciclo de aquecimento via Playwright.
          </p>

          <div>
            <label className="label">Browsers simultâneos</label>
            <input
              className="input"
              type="number"
              min="1"
              max="20"
              value={form.concurrentBrowsers ?? 5}
              onChange={(e) => set('concurrentBrowsers', parseInt(e.target.value) || 5)}
            />
            <p className="text-xs text-gray-600 mt-1">Quantidade de browsers abertos ao mesmo tempo.</p>
          </div>

          <div className="p-3 rounded-lg bg-blue-900/30 border border-blue-700/50 text-xs text-blue-300">
            <p className="font-medium mb-1">ℹ️ Fluxo de aquecimento automático:</p>
            <ol className="list-decimal ml-4 space-y-1 text-blue-200">
              <li>Adicione contas com email, senha e proxy</li>
              <li>Clique <strong>Aquecer Agora</strong> ou aguarde o cron diário (09:00)</li>
              <li>O sistema faz login no Google, assiste YouTube, navega notícias e abre Gmail</li>
              <li>Após 21 dias, a conta é marcada como <span className="text-green-400 font-medium">pronta para Google Ads</span></li>
            </ol>
          </div>
        </section>

        <button className="btn-primary" type="submit" disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </form>
    </div>
  );
}
