import { useState, useEffect, useRef } from 'react';
import { Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/index.js';
import LogEntry from '../components/LogEntry.jsx';

const FILTERS = ['todos', 'info', 'success', 'warn', 'error'];
const FILTER_LABELS = { todos: 'Todos', info: 'Info', success: 'Sucesso', warn: 'Aviso', error: 'Erro' };

export default function Logs({ liveLog }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('todos');
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const topRef = useRef(null);

  const PAGE_SIZE = 100;

  async function loadLogs(reset = false) {
    setLoading(true);
    try {
      const offset = reset ? 0 : page * PAGE_SIZE;
      const data = await api.getLogs(PAGE_SIZE, offset);
      if (reset) {
        setLogs(data);
        setPage(1);
      } else {
        setLogs((prev) => [...prev, ...data]);
        setPage((p) => p + 1);
      }
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adiciona log em tempo real no topo
  useEffect(() => {
    if (liveLog) {
      setLogs((prev) => [liveLog, ...prev]);
      if (autoScroll && topRef.current) {
        topRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [liveLog, autoScroll]);

  async function clearAll() {
    if (!confirm('Limpar todos os logs?')) return;
    try {
      await api.clearLogs();
      setLogs([]);
      setPage(0);
      setHasMore(true);
      toast.success('Logs limpos');
    } catch (e) {
      toast.error(e.message);
    }
  }

  const visible = filter === 'todos' ? logs : logs.filter((l) => l.type === filter);

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-100">Logs</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtros */}
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  filter === f
                    ? 'bg-brand-700 text-brand-100'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-100'
                }`}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          <button
            className="btn-secondary py-1 px-2.5 text-xs"
            onClick={() => loadLogs(true)}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            className="btn-danger py-1 px-2.5 text-xs"
            onClick={clearAll}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar
          </button>

          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-brand-500"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      <div ref={topRef} />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500">{visible.length} entrada(s)</span>
        </div>
        <div className="px-5 divide-y divide-gray-800/0">
          {visible.length === 0 ? (
            <p className="text-sm text-gray-600 py-8 text-center">Nenhum log encontrado.</p>
          ) : (
            visible.map((l) => <LogEntry key={l.id} log={l} />)
          )}
        </div>

        {hasMore && filter === 'todos' && (
          <div className="px-5 py-3 border-t border-gray-800">
            <button
              className="btn-secondary w-full justify-center text-xs py-2"
              onClick={() => loadLogs(false)}
              disabled={loading}
            >
              <ChevronDown className="w-4 h-4" />
              Carregar mais
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
