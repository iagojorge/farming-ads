import { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

const TIMEZONE_OPTIONS = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'UTC',
];

const CRON_PRESETS = [
  { label: 'Todo dia às 09:00', cron: '0 9 * * *' },
  { label: 'Todo dia às 13:00', cron: '0 13 * * *' },
  { label: 'Todo dia às 18:00', cron: '0 18 * * *' },
  { label: 'Seg–Sex às 09:00', cron: '0 9 * * 1-5' },
  { label: 'Seg–Sex às 13:00', cron: '0 13 * * 1-5' },
  { label: 'A cada hora', cron: '0 * * * *' },
];

const BLANK = {
  label: '',
  cron: '0 9 * * *',
  timezone: 'America/Sao_Paulo',
  profileIds: ['all'],
  enabled: true,
};

function ScheduleForm({ onSave, onCancel, initialData = BLANK, profiles }) {
  const [form, setForm] = useState(initialData);
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  function toggleProfileId(id) {
    if (id === 'all') {
      set('profileIds', ['all']);
      return;
    }
    const current = form.profileIds.filter((x) => x !== 'all');
    if (current.includes(id)) {
      const next = current.filter((x) => x !== id);
      set('profileIds', next.length ? next : ['all']);
    } else {
      set('profileIds', [...current, id]);
    }
  }

  const allSelected = form.profileIds.includes('all');

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h3 className="font-semibold text-gray-100">
        {initialData.id ? 'Editar agendamento' : 'Novo agendamento'}
      </h3>

      <div>
        <label className="label">Descrição</label>
        <input
          className="input"
          placeholder="Ex: Farming diário manhã"
          value={form.label}
          onChange={(e) => set('label', e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label">Expressão Cron</label>
        <input
          className="input font-mono"
          value={form.cron}
          onChange={(e) => set('cron', e.target.value)}
          required
          pattern="^(\S+ ){4}\S+$"
          title="Use formato cron: minuto hora dia-mês mês dia-semana"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => {
                set('cron', p.cron);
                if (!form.label) set('label', p.label);
              }}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors border border-gray-700"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Fuso Horário</label>
        <select
          className="input"
          value={form.timezone}
          onChange={(e) => set('timezone', e.target.value)}
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Perfis</label>
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => toggleProfileId('all')}
              className="accent-brand-500"
            />
            <span className="text-sm text-gray-300 group-hover:text-gray-100">Todos os perfis habilitados</span>
          </label>
          {profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={!allSelected && form.profileIds.includes(p.id)}
                onChange={() => toggleProfileId(p.id)}
                disabled={allSelected}
                className="accent-brand-500"
              />
              <span className={`text-sm ${allSelected ? 'text-gray-600' : 'text-gray-300 group-hover:text-gray-100'}`}>
                {p.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function Schedule() {
  const [schedules, setSchedules] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    api.getSchedules().then(setSchedules).catch(() => {});
    api.getProfiles().then(setProfiles).catch(() => {});
  }, []);

  async function handleSave(form) {
    try {
      if (editing) {
        const updated = await api.updateSchedule(editing.id, form);
        setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast.success('Agendamento atualizado');
      } else {
        const created = await api.createSchedule(form);
        setSchedules((prev) => [...prev, created]);
        toast.success('Agendamento criado');
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function removeSchedule(id) {
    try {
      await api.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      toast.success('Removido');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function toggleSchedule(schedule) {
    try {
      const updated = await api.updateSchedule(schedule.id, { ...schedule, enabled: !schedule.enabled });
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      toast.error(e.message);
    }
  }

  function openNew() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(schedule) {
    setEditing(schedule);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditing(null);
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-100">Agenda</h1>
        {!showForm && (
          <button className="btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" />
            Novo agendamento
          </button>
        )}
      </div>

      {showForm && (
        <ScheduleForm
          onSave={handleSave}
          onCancel={cancelForm}
          initialData={editing ?? undefined}
          profiles={profiles}
        />
      )}

      {schedules.length === 0 && !showForm ? (
        <div className="card text-center py-12">
          <CalendarClock className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 mb-3">Nenhum agendamento configurado.</p>
          <button className="btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" />
            Criar agendamento
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div key={s.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-medium text-gray-100 truncate">{s.label || 'Sem nome'}</p>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      s.enabled ? 'bg-brand-900/50 text-brand-400' : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    {s.enabled ? 'ativo' : 'inativo'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                  <span className="font-mono">{s.cron}</span>
                  <span>{s.timezone}</span>
                  <span>
                    {s.profileIds?.includes('all')
                      ? 'todos os perfis'
                      : `${s.profileIds?.length} perfil(is)`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => toggleSchedule(s)}
                  className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-brand-400 transition-colors"
                  title={s.enabled ? 'Desativar' : 'Ativar'}
                >
                  {s.enabled ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => openEdit(s)}
                  className="text-xs px-2 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-100 transition-colors"
                >
                  Editar
                </button>
                <button
                  onClick={() => removeSchedule(s.id)}
                  className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
