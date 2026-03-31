import { useState, useEffect } from 'react';
import { RefreshCw, Play, ToggleLeft, ToggleRight, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';

export default function Profiles({ workerStatus }) {
  const [profiles, setProfiles] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [runningId, setRunningId] = useState(null);

  const runningSet = new Set((workerStatus?.runningProfiles ?? []).map((p) => p.profileId));

  useEffect(() => {
    api.getProfiles().then(setProfiles).catch(() => {});
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const updated = await api.syncProfiles();
      setProfiles(updated);
      toast.success(`${updated.length} perfil(is) sincronizado(s)`);
    } catch (e) {
      toast.error(`Erro ao sincronizar: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleEnabled(profile) {
    try {
      const updated = await api.updateProfile(profile.id, { enabled: !profile.enabled });
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function updateDuration(profile, value) {
    const duration = parseInt(value);
    if (isNaN(duration) || duration < 1) return;
    try {
      const updated = await api.updateProfile(profile.id, { durationMinutes: duration });
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function runSingle(profileId) {
    setRunningId(profileId);
    try {
      await api.startWorker([profileId]);
      toast.success('Perfil iniciado');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunningId(null);
    }
  }

  const enabled = profiles.filter((p) => p.enabled).length;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Perfis</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {profiles.length} total &middot; {enabled} habilitado(s)
          </p>
        </div>
        <button className="btn-secondary" onClick={sync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          Sincronizar AdsPower
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-3">Nenhum perfil carregado.</p>
          <button className="btn-primary" onClick={sync} disabled={syncing}>
            <RefreshCw className="w-4 h-4" />
            Sincronizar agora
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Perfil
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                  Grupo
                </th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Duração&nbsp;(min)
                </th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Ativo
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const isRunning = runningSet.has(p.id);
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-800/60 last:border-0 transition-colors ${
                      isRunning ? 'bg-brand-900/20' : 'hover:bg-gray-800/30'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {isRunning && (
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse flex-shrink-0" />
                        )}
                        <span className="font-medium text-gray-100 truncate">{p.name}</span>
                        {p.serialNumber && (
                          <span className="text-xs text-gray-600">#{p.serialNumber}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-400 hidden sm:table-cell">
                      {p.groupName || '—'}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-600" />
                        <input
                          type="number"
                          min="1"
                          defaultValue={p.durationMinutes ?? 30}
                          onBlur={(e) => updateDuration(p, e.target.value)}
                          className="w-16 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleEnabled(p)} className="text-gray-400 hover:text-brand-400 transition-colors">
                        {p.enabled ? (
                          <ToggleRight className="w-6 h-6 text-brand-400" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        className="btn-secondary py-1 px-3 text-xs"
                        onClick={() => runSingle(p.id)}
                        disabled={isRunning || runningId === p.id || !p.enabled}
                      >
                        <Play className="w-3 h-3" />
                        Rodar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
