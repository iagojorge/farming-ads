import { addLog } from './store.js';
import { broadcast } from './events.js';
import { getWarmupWorkerStatus } from './warmupWorker.js';

// ── Estado do worker ──────────────────────────────────────────
let isRunning = false;
let stopRequested = false;

export function getWorkerStatus() {
  const warmupStatus = getWarmupWorkerStatus();
  return {
    isRunning,
    warmupStatus,
    activePeriods: warmupStatus.activePeriods || [],
  };
}

// ── Helpers ───────────────────────────────────────────────────
function makeLog(type, message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,        // 'info' | 'success' | 'warn' | 'error'
    message,
    timestamp: new Date().toISOString(),
  };
  addLog(entry);
  broadcast('log', entry);
  return entry;
}

function broadcastStatus() {
  broadcast('status', getWorkerStatus());
}

// ── API pública ───────────────────────────────────────────────
/**
 * Inicializa o worker (será chamado no startup).
 * O agendamento dos períodos é feito em scheduler.js
 */
export async function initWorker() {
  makeLog('info', 'Worker de warming de contas inicializado');
}

/**
 * Para o worker imediatamente.
 */
export function stopWorker() {
  stopRequested = true;
  isRunning = false;
  broadcastStatus();
  makeLog('warn', 'Worker de warming parado manualmente');
}
