import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  getSchedules,
  upsertSchedule,
  deleteSchedule,
  getLogs,
  clearLogs,
  getAccounts,
  addAccount,
  addAccounts,
  updateAccount,
  deleteAccount,
  getAccountsByStatus,
} from '../store.js';
import { stopWorker, getWorkerStatus } from '../worker.js';
import { runLoginAccounts, stopLoginWorker, getLoginWorkerStatus } from '../loginWorker.js';
import { runWarmupCycle, runWarmupForSelectedAccounts, getWarmupWorkerStatus, checkExpiredWarmups, cleanupStuckWarmingAccounts, startWarmup } from '../warmupWorker.js';
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
  // Sistema de warming baseado em períodos (refatorado)
  // Periods são executados automaticamente via scheduler, não via este endpoint antigo
  res.json({ started: true, note: 'Warming agora baseado em períodos automáticos' });
});

router.post('/worker/stop', (_req, res) => {
  stopWorker();
  res.json({ stopped: true });
});

// ── Schedule (Períodos de agendamento) ──────────────────────
/**
 * Retorna os 12 períodos de 2h com as contas alocadas em cada um
 */
router.get('/schedule/periods', (_req, res) => {
  const accounts = getAccounts();
  const periods = [];
  
  for (let i = 0; i < 12; i++) {
    const startHour = i * 2;
    const endHour = (i + 1) * 2;
    const startTime = `${String(startHour).padStart(2, '0')}:00`;
    const endTime = `${String(endHour % 24).padStart(2, '0')}:00`;
    
    const periodAccounts = accounts.filter(a => a.schedulePeriod === i);
    
    periods.push({
      period: i,
      startTime,
      endTime,
      accounts: periodAccounts.map(a => ({
        id: a.id,
        email: a.email,
        warmupStatus: a.warmupStatus,
        warmupProgress: a.warmupProgress,
        warmupCurrentStep: a.warmupCurrentStep,
      })),
      count: periodAccounts.length,
      maxCapacity: 10,
      available: 10 - periodAccounts.length,
    });
  }
  
  res.json(periods);
});

/**
 * Aloca uma conta em um período específico
 * POST body: { accountId, period }
 */
router.post('/schedule/allocate', (req, res) => {
  const { accountId, period } = req.body;
  
  if (!accountId || period === undefined || period === null) {
    return res.status(400).json({ error: 'accountId e period são obrigatórios' });
  }
  
  if (period < 0 || period > 11) {
    return res.status(400).json({ error: 'period deve estar entre 0 e 11' });
  }
  
  try {
    const accounts = getAccounts();
    const periodAccounts = accounts.filter(a => a.schedulePeriod === period);
    
    if (periodAccounts.length >= 10) {
      return res.status(400).json({ error: `Período ${period} já está cheio (máximo 10 contas)` });
    }
    
    const updated = updateAccount(accountId, { schedulePeriod: period });
    res.json(updated);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * Remove alocação de uma conta (schedulePeriod = null)
 */
router.delete('/schedule/allocate/:id', (req, res) => {
  try {
    const updated = updateAccount(req.params.id, { schedulePeriod: null });
    res.json(updated);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
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

// ── Accounts ──────────────────────────────────────────────────
router.get('/accounts', (_req, res) => {
  res.json(getAccounts());
});

router.post('/accounts', (req, res) => {
  const { email, password, proxy, recoveryEmail } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  const account = addAccount(email, password, proxy || '', recoveryEmail || '');
  res.status(201).json(account);
});

// Teste de proxy via Playwright
router.post('/accounts/test-proxy', async (req, res) => {
  const { proxy } = req.body;
  if (!proxy) return res.status(400).json({ error: 'Proxy é obrigatório' });

  try {
    const { chromium } = await import('playwright');
    const parts = proxy.split(':');
    const host = parts[0];
    const port = parts[1];
    const username = parts[2];
    const password = parts[3];

    const launchOpts = {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    };

    let proxyConfig = null;
    if (username && password) {
      proxyConfig = {
        server: `http://${host}:${port}`,
        username: username,
        password: password,
      };
    } else {
      proxyConfig = { server: `http://${host}:${port}` };
    }

    launchOpts.proxy = proxyConfig;

    const browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();

    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();

    await browser.close();

    res.json({
      success: true,
      message: `✓ Proxy funcionando! Título da página: "${title}"`,
      proxyType: username ? 'HTTP com autenticação' : 'HTTP sem autenticação',
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.message,
      hint: 'Verifique se as credenciais do proxy estão corretas ou se o proxy está bloqueando',
    });
  }
});

router.post('/accounts/batch', (req, res) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(400).json({ error: 'Envie um array de contas' });
  }
  const added = addAccounts(accounts);
  res.status(201).json(added);
});

router.put('/accounts/:id', (req, res) => {
  updateAccount(req.params.id, req.body);
  const updated = getAccounts().find((a) => a.id === req.params.id);
  res.json(updated);
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
    pendingCount: accounts.filter((a) => a.status === 'pending').length,
    warmingCount: accounts.filter((a) => a.status === 'warming').length,
    readyCount: accounts.filter((a) => a.status === 'ready_for_ads').length,
    syncedCount: accounts.filter((a) => a.status === 'synced').length,
    errorCount: accounts.filter((a) => a.status === 'error' || a.status === 'checkpoint').length,
  });
});

router.post('/warmup/run', (req, res) => {
  const { accountIds } = req.body || {};
  if (accountIds && accountIds.length > 0) {
    runWarmupForSelectedAccounts(accountIds).catch((err) => console.error('[api] Warmup error:', err.message));
  } else {
    runWarmupCycle().catch((err) => console.error('[api] Warmup error:', err.message));
  }
  res.json({ started: true });
});

router.post('/warmup/check-expired', (_req, res) => {
  const count = checkExpiredWarmups();
  res.json({ markedReady: count });
});

router.post('/warmup/cleanup-stuck', (_req, res) => {
  const count = cleanupStuckWarmingAccounts();
  res.json({ cleaned: count });
});

// Inicia aquecimento de uma conta específica
router.post('/accounts/:id/warmup', (req, res) => {
  try {
    const account = startWarmup(req.params.id);
    res.json(account);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

