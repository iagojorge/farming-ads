import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const STORE_FILE = join(DATA_DIR, 'store.json');

const DEFAULT_STORE = {
  settings: {
    adspowerUrl: 'http://local.adspower.net:50325',
    apiKey: '',
    groupName: 'Automatização teste',
    concurrentBrowsers: 5,
    timezone: 'America/Sao_Paulo',
  },
  profiles: [],
  schedules: [],
  logs: [],
  accounts: [],
};

let store = null;

export function initStore() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(STORE_FILE)) {
    store = structuredClone(DEFAULT_STORE);
    persist();
  } else {
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf-8'));
    store = {
      ...DEFAULT_STORE,
      ...raw,
      settings: { ...DEFAULT_STORE.settings, ...raw.settings },
    };
  }
}

function persist() {
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ── Settings ────────────────────────────────────────────────
export function getSettings() {
  return store.settings;
}

export function updateSettings(data) {
  store.settings = { ...store.settings, ...data };
  persist();
  return store.settings;
}

// ── Profiles ─────────────────────────────────────────────────
export function getProfiles() {
  return store.profiles;
}

export function upsertProfiles(adspowerProfiles) {
  const existing = new Map(store.profiles.map((p) => [p.id, p]));
  store.profiles = adspowerProfiles.map((p) => ({
    enabled: true,
    durationMinutes: store.settings.defaultDurationMinutes,
    ...existing.get(p.user_id),
    id: p.user_id,
    name: p.name,
    serialNumber: p.serial_number,
    groupName: p.group_name,
  }));
  persist();
  return store.profiles;
}

export function updateProfile(id, data) {
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('Perfil não encontrado');
  store.profiles[idx] = { ...store.profiles[idx], ...data };
  persist();
  return store.profiles[idx];
}

// ── Schedules ────────────────────────────────────────────────
export function getSchedules() {
  return store.schedules;
}

export function upsertSchedule(schedule) {
  const idx = store.schedules.findIndex((s) => s.id === schedule.id);
  if (idx === -1) {
    store.schedules.push(schedule);
  } else {
    store.schedules[idx] = schedule;
  }
  persist();
  return schedule;
}

export function deleteSchedule(id) {
  store.schedules = store.schedules.filter((s) => s.id !== id);
  persist();
}

// ── Logs ──────────────────────────────────────────────────────
export function addLog(entry) {
  store.logs.unshift(entry);
  if (store.logs.length > 500) store.logs = store.logs.slice(0, 500);
  persist();
}

export function getLogs(limit = 100, offset = 0) {
  return store.logs.slice(offset, offset + limit);
}

export function clearLogs() {
  store.logs = [];
  persist();
}

// ── Accounts ──────────────────────────────────────────────────
export function getAccounts() {
  return store.accounts;
}

export function addAccount(email, password, proxy = '', recoveryEmail = '') {
  const account = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email,
    password,
    proxy,
    recoveryEmail,
    // Estados: pending → warming → ready_for_ads → synced | error | checkpoint
    status: 'pending',
    profileId: null,
    error: null,
    createdAt: new Date().toISOString(),
    warmupStartDate: null,
    warmupEndDate: null,
    warmupDaysDone: 0,
    lastWarmupAt: null,
    adsCustomerId: null,
  };
  store.accounts.push(account);
  persist();
  return account;
}

export function addAccounts(list) {
  const now = Date.now();
  const accounts = list.map(({ email, password, proxy, recoveryEmail }, i) => ({
    id: `${now + i}-${Math.random().toString(36).slice(2)}`,
    email,
    password,
    proxy: proxy || '',
    recoveryEmail: recoveryEmail || '',
    status: 'pending',
    profileId: null,
    error: null,
    createdAt: new Date().toISOString(),
    warmupStartDate: null,
    warmupEndDate: null,
    warmupDaysDone: 0,
    lastWarmupAt: null,
    adsCustomerId: null,
  }));
  store.accounts.push(...accounts);
  persist();
  return accounts;
}

export function updateAccount(id, data) {
  const idx = store.accounts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Conta não encontrada');
  store.accounts[idx] = { ...store.accounts[idx], ...data };
  persist();
  return store.accounts[idx];
}

export function deleteAccount(id) {
  store.accounts = store.accounts.filter((a) => a.id !== id);
  persist();
}

export function getAccountsByStatus(status) {
  return store.accounts.filter((a) => a.status === status);
}
