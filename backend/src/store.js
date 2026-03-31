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
    rpaFlowId: '',
    rpaProcessId: '',           // ID do processo RPA Plus (ex: RPA_1774630007372)
    concurrentProfiles: 1,
    defaultDurationMinutes: 30,
    rpaMode: 'auto',
    timezone: 'America/Sao_Paulo',
    groupName: 'Automatização teste',
    // Aquecimento automático
    warmupDays: 21,             // dias de aquecimento por conta
    warmupDailyTime: '09:00',   // horário de execução diária (HH:MM)
    warmupSessionMinutes: 30,   // duração de cada sessão diária
  },
  profiles: [],
  schedules: [],
  logs: [],
  accounts: [], // { email, password, status: 'pending'|'completed', profileId?, createdAt }
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

export function addAccount(email, password, proxy = '') {
  const account = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email,
    password,
    proxy,
    status: 'pending',
    profileId: null,
    error: null,
    createdAt: new Date().toISOString(),
    warmupStatus: 'pending',
    warmupStartDate: null,
    warmupEndDate: null,
    lastWarmupAt: null,
  };
  store.accounts.push(account);
  persist();
  return account;
}

export function addAccounts(list) {
  const now = Date.now();
  const accounts = list.map(({ email, password, proxy }, i) => ({
    id: `${now + i}-${Math.random().toString(36).slice(2)}`,
    email,
    password,
    proxy: proxy || '',
    status: 'pending',
    profileId: null,
    error: null,
    createdAt: new Date().toISOString(),
    warmupStatus: 'pending',
    warmupStartDate: null,
    warmupEndDate: null,
    lastWarmupAt: null,
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

// Contas com aquecimento ativo
export function getWarmingAccounts() {
  return store.accounts.filter((a) => a.warmupStatus === 'warming' && a.profileId);
}
