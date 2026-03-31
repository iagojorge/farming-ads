import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

const RPA_MODE_INFO = {
  auto: '✅ RECOMENDADO — Configure o fluxo RPA no AdsPower (em "Ações automáticas" do perfil) para iniciar automaticamente.',
  api: '❌ NÃO DISPONÍVEL — Sua versão do AdsPower não pode disparar RPA via API. Use o modo "auto".',
};

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
              Padrão: <code>http://local.adspower.net:50325</code> — certifique-se que o AdsPower está aberto.
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
              Perfis criados automaticamente serão adicionados a este grupo. Se não existir, será criado.
            </p>
          </div>
        </section>

        {/* RPA */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">Fluxo RPA</h2>

          <div>
            <label className="label">ID do Processo RPA Plus</label>
            <input
              className="input font-mono"
              value={form.rpaProcessId || ''}
              onChange={(e) => set('rpaProcessId', e.target.value)}
              placeholder="RPA_1774630007372"
            />
            <p className="text-xs text-gray-500 mt-1">
              Encontre em <strong>RPA Plus → Processo</strong> no AdsPower. Configure esse processo como
              &ldquo;Ação automática&rdquo; dos perfis para executar ao abrir o browser.
            </p>
          </div>

          <div>
            <label className="label">Modo de execução do RPA</label>
            <div className="flex gap-3">
              {['auto', 'api'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => set('rpaMode', mode)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    form.rpaMode === mode
                      ? 'border-brand-500 bg-brand-900/40 text-brand-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-100'
                  }`}
                >
                  {mode === 'auto' ? 'Auto (perfil)' : 'API'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">{RPA_MODE_INFO[form.rpaMode]}</p>
          </div>
        </section>

        {/* Aquecimento */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">Aquecimento Automático</h2>
          <p className="text-xs text-gray-500">
            Ao adicionar uma conta, o sistema agenda sessões diárias automáticas por <strong>{form.warmupDays ?? 21} dias</strong>.
            Após esse período, a conta é marcada como <span className="text-green-400 font-medium">aquecida</span>.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Dias de aquecimento</label>
              <input
                className="input"
                type="number"
                min="1"
                max="90"
                value={form.warmupDays ?? 21}
                onChange={(e) => set('warmupDays', parseInt(e.target.value) || 21)}
              />
              <p className="text-xs text-gray-600 mt-1">Padrão: 21 dias (3 semanas)</p>
            </div>
            <div>
              <label className="label">Horário diário</label>
              <input
                className="input"
                type="time"
                value={form.warmupDailyTime || '09:00'}
                onChange={(e) => set('warmupDailyTime', e.target.value)}
              />
              <p className="text-xs text-gray-600 mt-1">Hora que as sessões iniciam todo dia</p>
            </div>
            <div>
              <label className="label">Duração da sessão (min)</label>
              <input
                className="input"
                type="number"
                min="5"
                max="480"
                value={form.warmupSessionMinutes ?? 30}
                onChange={(e) => set('warmupSessionMinutes', parseInt(e.target.value) || 30)}
              />
              <p className="text-xs text-gray-600 mt-1">Quanto tempo fica aberto por dia</p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-900/30 border border-blue-700/50 text-xs text-blue-300">
            <p className="font-medium mb-1">ℹ️ Como configurar o RPA para executar automaticamente:</p>
            <ol className="list-decimal ml-4 space-y-1 text-blue-200">
              <li>Abra o AdsPower e clique com o botão direito em um perfil → <strong>Editar</strong></li>
              <li>Vá até <strong>Outras configurações → Ações automáticas</strong></li>
              <li>Selecione <strong>Criar nova regra</strong>, escolha seu processo RPA</li>
              <li>Defina o gatilho como <strong>Ao abrir o browser</strong></li>
              <li>Salve — agora toda vez que nosso worker abrir o browser, o RPA executará automaticamente</li>
            </ol>
          </div>
        </section>

        {/* Worker */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wider">Worker</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Perfis simultâneos</label>
              <input
                className="input"
                type="number"
                min="1"
                max="20"
                value={form.concurrentProfiles}
                onChange={(e) => set('concurrentProfiles', parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-gray-600 mt-1">Quantidade de browsers abertos ao mesmo tempo.</p>
            </div>
            <div>
              <label className="label">Duração padrão (min)</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.defaultDurationMinutes}
                onChange={(e) => set('defaultDurationMinutes', parseInt(e.target.value) || 30)}
              />
              <p className="text-xs text-gray-600 mt-1">Usada quando o perfil não tem duração própria.</p>
            </div>
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
