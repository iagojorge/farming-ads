import { Router } from 'express';
import { listProfiles, checkProxy, listGroups } from '../adspower.js';
import {
  getSettings,
  updateSettings,
  getProfiles,
  upsertProfiles,
  updateProfile,
  getSchedules,
  upsertSchedule,
  deleteSchedule,
  getLogs,
  clearLogs,
  getAccounts,
  addAccount,
  addAccounts,
  deleteAccount,
  getWarmingAccounts,
} from '../store.js';
import { runProfiles, stopWorker, getWorkerStatus } from '../worker.js';
import { runLoginAccounts, stopLoginWorker, getLoginWorkerStatus } from '../loginWorker.js';
import { runWarmupCycle, getWarmupWorkerStatus, checkExpiredWarmups } from '../warmupWorker.js';
import { setupSchedules, setupWarmupSchedule } from '../scheduler.js';
import { addClient, removeClient, broadcast } from '../events.js';

export const router = Router();

// ── SSE ──────────────────────────────────────────────────────
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Envia status atual imediatamente ao conectar
  res.write(`event: status\ndata: ${JSON.stringify(getWorkerStatus())}\n\n`);

  addClient(res);
  req.on('close', () => removeClient(res));
});

// ── Settings ─────────────────────────────────────────────────
router.get('/settings', (_req, res) => res.json(getSettings()));

router.put('/settings', (req, res) => {
  const updated = updateSettings(req.body);
  setupSchedules();
  setupWarmupSchedule(); // recria cron com novo horário
  res.json(updated);
});

// ── Profiles ─────────────────────────────────────────────────
router.get('/profiles', (_req, res) => res.json(getProfiles()));

router.post('/profiles/sync', async (_req, res) => {
  try {
    const adspowerList = await listProfiles();
    const profiles = upsertProfiles(adspowerList);
    res.json(profiles);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.put('/profiles/:id', (req, res) => {
  try {
    const profile = updateProfile(req.params.id, req.body);
    res.json(profile);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Schedules ────────────────────────────────────────────────
router.get('/schedules', (_req, res) => res.json(getSchedules()));

router.post('/schedules', (req, res) => {
  const schedule = {
    ...req.body,
    id: Date.now().toString(),
    enabled: req.body.enabled !== false,
  };
  upsertSchedule(schedule);
  setupSchedules();
  res.status(201).json(schedule);
});

router.put('/schedules/:id', (req, res) => {
  const schedule = { ...req.body, id: req.params.id };
  upsertSchedule(schedule);
  setupSchedules();
  res.json(schedule);
});

router.delete('/schedules/:id', (req, res) => {
  deleteSchedule(req.params.id);
  setupSchedules();
  res.json({ success: true });
});

// ── Worker ───────────────────────────────────────────────────
router.get('/worker/status', (_req, res) => res.json(getWorkerStatus()));

router.post('/worker/run', (req, res) => {
  const { profileIds } = req.body || {};
  // Fire-and-forget — não bloqueia o request
  runProfiles(profileIds || null).catch((err) => {
    console.error('[api] Worker error:', err.message);
    broadcast('log', {
      id: Date.now().toString(),
      type: 'error',
      profileId: null,
      profileName: null,
      message: `Erro no worker: ${err.message}`,
      timestamp: new Date().toISOString(),
    });
  });
  res.json({ started: true });
});

router.post('/worker/stop', (_req, res) => {
  stopWorker();
  res.json({ stopped: true });
});

// ── Logs ─────────────────────────────────────────────────────
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  res.json(getLogs(limit, offset));
});

router.delete('/logs', (_req, res) => {
  clearLogs();
  res.json({ cleared: true });
});

// ── AdsPower passthrough ──────────────────────────────────────

router.get('/adspower/rpa-flows', async (_req, res) => {
  // Tenta buscar fluxos RPA, mas retorna array vazio se não suportado
  try {
    const client = require('axios').create({
      baseURL: require('../store.js').getSettings().adspowerUrl,
      timeout: 10000,
    });
    const result = await client.get('/api/v1/rpa/flow/list').catch(() => ({ data: { data: [] } }));
    res.json(result.data?.data?.list || []);
  } catch {
    res.json([]); // Retorna array vazio se endpoint não suportado
  }
});

router.get('/adspower/groups', async (_req, res) => {
  try {
    const groups = await listGroups();
    res.json(groups);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Accounts ──────────────────────────────────────────────────
router.get('/accounts', (_req, res) => {
  res.json(getAccounts());
});

router.post('/accounts', (req, res) => {
  const { email, password, proxy } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  const account = addAccount(email, password, proxy || '');
  res.status(201).json(account);
});

router.post('/accounts/check-proxy', async (req, res) => {
  const { proxy } = req.body;
  if (!proxy) return res.status(400).json({ error: 'Proxy é obrigatório' });
  const result = await checkProxy(proxy);
  res.json(result);
});

router.post('/accounts/batch', (req, res) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: 'Envie um array de contas' });
  }
  const added = addAccounts(accounts);
  res.status(201).json(added);
});

router.delete('/accounts/:id', (req, res) => {
  deleteAccount(req.params.id);
  res.json({ success: true });
});

// ── Login Worker ──────────────────────────────────────────────
router.get('/accounts/login-status', (_req, res) => {
  res.json(getLoginWorkerStatus());
});

// Inicia login automático para contas selecionadas (ou todas pendentes)
router.post('/accounts/login', (req, res) => {
  const { accountIds } = req.body || {};
  runLoginAccounts(accountIds?.length ? accountIds : null).catch((err) => {
    console.error('[api] Login worker error:', err.message);
  });
  res.json({ started: true });
});

router.post('/accounts/login/stop', (_req, res) => {
  stopLoginWorker();
  res.json({ stopped: true });
});

// ── Warmup ──────────────────────────────────────────────────
router.get('/warmup/status', (_req, res) => {
  const accounts = getAccounts();
  res.json({
    ...getWarmupWorkerStatus(),
    warmingCount: accounts.filter((a) => a.warmupStatus === 'warming').length,
    warmedCount: accounts.filter((a) => a.warmupStatus === 'warmed').length,
    pendingCount: accounts.filter((a) => a.warmupStatus === 'pending').length,
  });
});

router.post('/warmup/run', (_req, res) => {
  runWarmupCycle().catch((err) => console.error('[api] Warmup error:', err.message));
  res.json({ started: true });
});

router.post('/warmup/check-expired', (_req, res) => {
  const count = checkExpiredWarmups();
  res.json({ markedWarmed: count });
});

