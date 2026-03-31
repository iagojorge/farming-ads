const TYPE_CONF = {
  info:    { dot: 'bg-blue-400',    text: 'text-blue-300',   label: 'INFO' },
  success: { dot: 'bg-brand-400',   text: 'text-brand-400',  label: 'OK' },
  warn:    { dot: 'bg-yellow-400',  text: 'text-yellow-300', label: 'AVISO' },
  error:   { dot: 'bg-red-400',     text: 'text-red-400',    label: 'ERRO' },
};

export default function LogEntry({ log }) {
  const conf = TYPE_CONF[log.type] || TYPE_CONF.info;
  const time = new Date(log.timestamp).toLocaleTimeString('pt-BR');

  return (
    <div className="flex gap-3 items-start py-2 border-b border-gray-800/60 last:border-0">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${conf.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold ${conf.text}`}>{conf.label}</span>
          {log.profileName && (
            <span className="text-xs text-gray-500 truncate">{log.profileName}</span>
          )}
          <span className="text-xs text-gray-600 ml-auto tabular-nums">{time}</span>
        </div>
        <p className="text-sm text-gray-300 mt-0.5 break-words">{log.message}</p>
      </div>
    </div>
  );
}
