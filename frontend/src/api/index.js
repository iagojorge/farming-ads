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

  // Profiles
  getProfiles: () => req('GET', '/profiles'),
  syncProfiles: () => req('POST', '/profiles/sync'),
  updateProfile: (id, data) => req('PUT', `/profiles/${id}`, data),

  // Schedules
  getSchedules: () => req('GET', '/schedules'),
  createSchedule: (data) => req('POST', '/schedules', data),
  updateSchedule: (id, data) => req('PUT', `/schedules/${id}`, data),
  deleteSchedule: (id) => req('DELETE', `/schedules/${id}`),

  // Worker
  getStatus: () => req('GET', '/worker/status'),
  startWorker: (profileIds) => req('POST', '/worker/run', { profileIds }),
  stopWorker: () => req('POST', '/worker/stop'),

  // Logs
  getLogs: (limit, offset) => req('GET', `/logs?limit=${limit ?? 100}&offset=${offset ?? 0}`),
  clearLogs: () => req('DELETE', '/logs'),

  // AdsPower\n  getRpaFlows: () => req('GET', '/adspower/rpa-flows'),

  // Accounts
  getAccounts: () => req('GET', '/accounts'),
  addAccount: (email, password, proxy) => req('POST', '/accounts', { email, password, proxy }),
  addAccountsBatch: (accounts) => req('POST', '/accounts/batch', { accounts }),
  deleteAccount: (id) => req('DELETE', `/accounts/${id}`),
  checkProxy: (proxy) => req('POST', '/accounts/check-proxy', { proxy }),
  // Login Worker
  getLoginStatus: () => req('GET', '/accounts/login-status'),
  startLogin: (accountIds) => req('POST', '/accounts/login', { accountIds }),
  stopLogin: () => req('POST', '/accounts/login/stop'),

  // Warmup
  getWarmupStatus: () => req('GET', '/warmup/status'),
  triggerWarmup: () => req('POST', '/warmup/run'),
  checkExpiredWarmups: () => req('POST', '/warmup/check-expired'),
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
  es.onerror = () => {};
  return es;
}
