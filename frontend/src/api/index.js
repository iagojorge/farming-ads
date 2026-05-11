const BASE = '/api';

async function req(method, path, body) {
  const token = localStorage.getItem('token');
  const headers = {
    ...(body && { 'Content-Type': 'application/json' }),
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Se receber 401, token expirou
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login';
  }

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
  addAccount: (email, password, proxy, recoveryEmail, cnpj) => req('POST', '/accounts', { email, password, proxy, recoveryEmail, cnpj }),
  addAccountsBatch: (accounts) => req('POST', '/accounts/batch', { accounts }),
  updateAccount: (id, data) => req('PUT', `/accounts/${id}`, data),
  deleteAccount: (id) => req('DELETE', `/accounts/${id}`),
  bulkUpdateCnpj: (entries) => req('POST', '/accounts/bulk-cnpj', { entries }),
  // Login Worker
  getLoginStatus: () => req('GET', '/accounts/login-status'),
  startLogin: (accountIds) => req('POST', '/accounts/login', { accountIds }),
  stopLogin: () => req('POST', '/accounts/login/stop'),

  // Warmup
  getWarmupStatus: () => req('GET', '/warmup/status'),
  triggerWarmup: (accountIds) => req('POST', '/warmup/run', { accountIds: accountIds || [] }),
  stopWarmup: () => req('POST', '/warmup/stop'),
  checkExpiredWarmups: () => req('POST', '/warmup/check-expired'),
  startWarmupAccount: (id) => req('POST', `/accounts/${id}/warmup`),
  runGoogleAds: (accountIds) => req('POST', '/warmup/google-ads', { accountIds }),
  stopGoogleAds: () => req('POST', '/warmup/google-ads/stop'),
  openChrome: (accountIds) => req('POST', '/warmup/open-chrome', { accountIds }),
  stopOpenChrome: () => req('POST', '/warmup/open-chrome/stop'),

  // Recovery Email
  getRecoveryStatus: () => req('GET', '/accounts/recovery-status'),
  updateRecoveryEmail: (accountIds) => req('POST', '/accounts/update-recovery-email', { accountIds }),
  stopRecoveryEmail: () => req('POST', '/accounts/recovery-email/stop'),

  // Ready Accounts
  exportCookies: (accountIds) => req('POST', '/accounts/export-cookies', { accountIds: accountIds || [] }),
};

/**
 * Cria um EventSource SSE contra /api/events e despacha callbacks.
 * @param {(event: string, data: any) => void} onEvent
 * @param {string} token - Token JWT
 * @returns {EventSource}
 */
export function createEventSource(onEvent, token) {
  const url = token ? `${BASE}/events?token=${encodeURIComponent(token)}` : `${BASE}/events`;
  const es = new EventSource(url);
  es.addEventListener('status', (e) => onEvent('status', JSON.parse(e.data)));
  es.addEventListener('log', (e) => onEvent('log', JSON.parse(e.data)));
  es.addEventListener('login-status', (e) => onEvent('login-status', JSON.parse(e.data)));
  es.addEventListener('account-update', (e) => onEvent('account-update', JSON.parse(e.data)));
  es.addEventListener('warming-status', (e) => onEvent('warming-status', JSON.parse(e.data)));
  es.onerror = () => {};
  return es;
}
