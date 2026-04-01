import { runWarmupSession } from './warmupEngine.js';
import { TIMINGS } from './warmupTimings.js';
import { getSettings, getAccountsByStatus, getAccounts, updateAccount, addLog } from './store.js';
import { broadcast } from './events.js';

let isRunning = false;
let activePeriodWarmups = new Map(); // period → { accounts: [...], startTime }

export function getWarmupWorkerStatus() {
  return { 
    isRunning,
    activePeriods: Array.from(activePeriodWarmups.entries()).map(([period, data]) => ({
      period,
      accountsCount: data.accounts?.length,
      startTime: data.startTime,
    })),
  };
}

function makeLog(type, email, message) {
  const entry = {
    id: `wu-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    profileId: null,
    profileName: `Warmup – ${email || 'sistema'}`,
    message,
    timestamp: new Date().toISOString(),
  };
  addLog(entry);
  broadcast('log', entry);
}

/**
 * Verifica contas cujo período de aquecimento expirou e as marca como ready_for_ads.
 */
export function checkExpiredWarmups() {
  const now = new Date();
  const warming = getAccountsByStatus('warming');
  let count = 0;

  for (const account of warming) {
    if (account.warmupEndDate && new Date(account.warmupEndDate) <= now) {
      updateAccount(account.id, { status: 'ready_for_ads' });
      makeLog('success', account.email, `🎉 ${account.email}: ${TIMINGS.warmupDays} dias de aquecimento concluídos! Pronta para Google Ads.`);
      count++;
    }
  }

  return count;
}

/**
 * Inicia o aquecimento de uma conta pendente
 * (marca como warming e define datas).
 */
export function startWarmup(accountId) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + TIMINGS.warmupDays);

  return updateAccount(accountId, {
    status: 'warming',
    warmupStartDate: now.toISOString(),
    warmupEndDate: end.toISOString(),
    warmupDaysDone: 0,
    warmupStatus: 'idle',
  });
}

/**
 * Executa uma sessão de aquecimento para uma conta individual (Playwright).
 */
async function runSingleWarmup(account) {
  const { id, email } = account;

  // Atualiza status para warming
  updateAccount(id, { warmupStatus: 'warming', warmupStartTime: new Date().toISOString() });
  broadcast('account-update', { id, warmupStatus: 'warming' });

  // Verifica se o período já expirou
  if (account.warmupEndDate && new Date(account.warmupEndDate) <= new Date()) {
    updateAccount(id, { status: 'ready_for_ads', warmupStatus: 'completed' });
    makeLog('success', email, `🎉 ${email}: Aquecimento concluído! Pronta para Google Ads.`);
    broadcast('account-update', { id, status: 'ready_for_ads', warmupStatus: 'completed' });
    return;
  }

  const daysLeft = account.warmupEndDate
    ? Math.max(0, Math.ceil((new Date(account.warmupEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : '?';

  makeLog('info', email, `${email}: Iniciando sessão de aquecimento (dia ${(account.warmupDaysDone || 0) + 1}) — ~${daysLeft} dia(s) restante(s)`);

  try {
    // Atualiza step para gmail
    const updateStep = (step) => {
      updateAccount(id, { warmupCurrentStep: step });
      broadcast('account-update', { id, warmupCurrentStep: step });
    };

    const result = await runWarmupSession(account, (msg) => {
      makeLog('info', email, `${email}: ${msg}`);
      // Atualiza step baseado em mensagem
      if (msg.includes('Gmail') || msg.includes('email')) updateStep('gmail');
      if (msg.includes('YouTube')) updateStep('youtube');
      if (msg.includes('Globo')) updateStep('globo');
    });

    if (!result.success) {
      if (result.error?.includes('checkpoint')) {
        updateAccount(id, { status: 'checkpoint', error: 'Google pediu verificação', warmupStatus: 'paused' });
        makeLog('warn', email, `⚠️ ${email}: Checkpoint detectado — verificação manual necessária.`);
        broadcast('account-update', { id, status: 'checkpoint', warmupStatus: 'paused' });
        return;
      }
      updateAccount(id, { error: result.error, warmupStatus: 'idle' });
      makeLog('error', email, `${email}: Falha: ${result.error}`);
      broadcast('account-update', { id, error: result.error, warmupStatus: 'idle' });
      return;
    }

    // Calcula progresso
    const newDaysDone = (account.warmupDaysDone || 0) + 1;
    const progress = Math.min(100, Math.round((newDaysDone / TIMINGS.warmupDays) * 100));

    updateAccount(id, {
      lastWarmupAt: new Date().toISOString(),
      warmupDaysDone: newDaysDone,
      warmupProgress: progress,
      warmupStatus: 'idle',
      warmupCurrentStep: 'done',
    });
    makeLog('success', email, `${email}: Sessão concluída. ~${daysLeft} dia(s) restante(s).`);
    broadcast('account-update', { id, warmupDaysDone: newDaysDone, warmupProgress: progress, warmupStatus: 'idle' });
  } catch (err) {
    makeLog('error', email, `${email}: Erro na sessão: ${err.message}`);
    updateAccount(id, { error: err.message, warmupStatus: 'idle' });
    broadcast('account-update', { id, error: err.message, warmupStatus: 'idle' });
  }
}

/**
 * Executa warming para contas alocadas em um período específico (novo sistema)
 */
export async function runWarmupForPeriod(period) {
  const allAccounts = getAccounts();
  const periodAccounts = allAccounts.filter((a) => a.schedulePeriod === period && a.status === 'warming');

  if (periodAccounts.length === 0) {
    makeLog('info', null, `Período ${period}: Nenhuma conta para aquecer.`);
    return;
  }

  activePeriodWarmups.set(period, {
    accounts: periodAccounts,
    startTime: new Date().toISOString(),
  });
  broadcast('warming-status', { isRunning: true, period, count: periodAccounts.length });

  try {
    makeLog('info', null, `Período ${period}: Iniciando aquecimento para ${periodAccounts.length} conta(s)`);

    // Filtra contas que não foram aquecidas hoje
    const today = new Date().toISOString().slice(0, 10);
    const toWarm = periodAccounts.filter((a) => !a.lastWarmupAt || a.lastWarmupAt.slice(0, 10) !== today);

    if (toWarm.length === 0) {
      makeLog('info', null, `Período ${period}: Todas as ${periodAccounts.length} conta(s) já foram aquecidas hoje.`);
      return;
    }

    const concurrency = Math.max(1, getSettings().concurrentBrowsers || TIMINGS.concurrentBrowsers);

    // Executa warming em paralelo com limite de concorrência
    for (let i = 0; i < toWarm.length; i += concurrency) {
      const batch = toWarm.slice(i, i + concurrency);
      await Promise.all(batch.map((a) => runSingleWarmup(a)));
    }

    makeLog('info', null, `Período ${period}: Ciclo de aquecimento finalizado (${toWarm.length} conta(s))`);
  } finally {
    activePeriodWarmups.delete(period);
    broadcast('warming-status', { isRunning: false, period });
  }
}

/**
 * Executa o ciclo de aquecimento para todas as contas warming.
 */
export async function runWarmupCycle() {
  if (isRunning) {
    makeLog('warn', null, 'Ciclo já em execução, ignorando.');
    return;
  }

  isRunning = true;
  broadcast('warmup-status', { isRunning: true });

  try {
    // Marca expirados antes
    const expired = checkExpiredWarmups();
    if (expired > 0) {
      makeLog('info', null, `${expired} conta(s) marcadas como prontas para Google Ads.`);
    }

    // Inicia aquecimento de contas pendentes automaticamente
    const pending = getAccountsByStatus('pending');
    for (const account of pending) {
      startWarmup(account.id);
      makeLog('info', account.email, `${account.email}: Aquecimento iniciado (${TIMINGS.warmupDays} dias).`);
    }

    const accounts = getAccountsByStatus('warming');

    if (accounts.length === 0) {
      makeLog('info', null, 'Nenhuma conta em aquecimento ativo no momento.');
      return;
    }

    // Filtra contas que já foram aquecidas hoje
    const today = new Date().toISOString().slice(0, 10);
    const toWarm = accounts.filter((a) => !a.lastWarmupAt || a.lastWarmupAt.slice(0, 10) !== today);

    if (toWarm.length === 0) {
      makeLog('info', null, 'Todas as contas já foram aquecidas hoje.');
      return;
    }

    makeLog('info', null, `Iniciando ciclo de aquecimento para ${toWarm.length} conta(s)`);

    const concurrency = Math.max(1, getSettings().concurrentBrowsers || TIMINGS.concurrentBrowsers);

    for (let i = 0; i < toWarm.length; i += concurrency) {
      const batch = toWarm.slice(i, i + concurrency);
      await Promise.all(batch.map((a) => runSingleWarmup(a)));
    }

    makeLog('info', null, 'Ciclo de aquecimento finalizado.');
  } finally {
    isRunning = false;
    broadcast('warmup-status', { isRunning: false });
  }
}
