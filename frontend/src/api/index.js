const BASE = '/api';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Settings
  getSettings: () => req('GET', '/settings'),
  updateSettings: (data) => req('PUT', '/settings', data),

  // Schedules
  getSchedules: () => req('GET', '/schedules'),
  createSchedule: (data) => req('POST', '/schedules', data),
  updateSchedule: (id, data) => req('PUT', `/schedules/${id}`, data),
  deleteSchedule: (id) => req('DELETE', `/schedules/${id}`),

  // Schedule Periods (novo sistema de agendamento)
  getSchedulePeriods: () => req('GET', '/schedule/periods'),
  allocateAccountToPeriod: (accountId, period) => req('POST', '/schedule/allocate', { accountId, period }),
  deallocateAccount: (accountId) => req('DELETE', `/schedule/allocate/${accountId}`),

  // Worker
  getStatus: () => req('GET', '/worker/status'),
  startWorker: (profileIds) => req('POST', '/worker/run', { profileIds }),
  stopWorker: () => req('POST', '/worker/stop'),

  // Logs
  getLogs: (limit, offset) => req('GET', `/logs?limit=${limit ?? 100}&offset=${offset ?? 0}`),
  clearLogs: () => req('DELETE', '/logs'),

  // Accounts
  getAccounts: () => req('GET', '/accounts'),
  addAccount: (email, password, proxy, recoveryEmail) => req('POST', '/accounts', { email, password, proxy, recoveryEmail }),
  addAccountsBatch: (accounts) => req('POST', '/accounts/batch', { accounts }),
  deleteAccount: (id) => req('DELETE', `/accounts/${id}`),
  // Login Worker
  getLoginStatus: () => req('GET', '/accounts/login-status'),
  startLogin: (accountIds) => req('POST', '/accounts/login', { accountIds }),
  stopLogin: () => req('POST', '/accounts/login/stop'),

  // Warmup
  getWarmupStatus: () => req('GET', '/warmup/status'),
  triggerWarmup: () => req('POST', '/warmup/run'),
  checkExpiredWarmups: () => req('POST', '/warmup/check-expired'),
  startWarmupAccount: (id) => req('POST', `/accounts/${id}/warmup`),
};

/**
 * Cria um EventSource SSE contra /api/events e despacha callbacks.
 * @param {(event: string, data: any) => void} onEvent
 * @returns {EventSource}
 */
export function createEventSource(onEvent) {
  const es = new EventSource(`${BASE}/events`);
  es.addEventListener('status', (e) => onEvent('status', JSON.parse(e.data)));
  es.addEventListener('log', (e) => onEvent('log', JSON.parse(e.data)));
  es.addEventListener('login-status', (e) => onEvent('login-status', JSON.parse(e.data)));
  es.addEventListener('account-update', (e) => onEvent('account-update', JSON.parse(e.data)));
  es.addEventListener('warming-status', (e) => onEvent('warming-status', JSON.parse(e.data)));
  es.onerror = () => {};
  return es;
}
