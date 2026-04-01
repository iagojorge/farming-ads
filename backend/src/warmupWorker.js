import { runWarmupSession } from './warmupEngine.js';
import { TIMINGS } from './warmupTimings.js';
import { getSettings, getAccountsByStatus, updateAccount, addLog } from './store.js';
import { broadcast } from './events.js';

let isRunning = false;

export function getWarmupWorkerStatus() {
  return { isRunning };
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
  });
}

/**
 * Executa uma sessão de aquecimento para uma conta individual (Playwright).
 */
async function runSingleWarmup(account) {
  const { id, email } = account;

  // Verifica se o período já expirou
  if (account.warmupEndDate && new Date(account.warmupEndDate) <= new Date()) {
    updateAccount(id, { status: 'ready_for_ads' });
    makeLog('success', email, `🎉 ${email}: Aquecimento concluído! Pronta para Google Ads.`);
    return;
  }

  const daysLeft = account.warmupEndDate
    ? Math.max(0, Math.ceil((new Date(account.warmupEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : '?';

  makeLog('info', email, `${email}: Iniciando sessão de aquecimento (dia ${(account.warmupDaysDone || 0) + 1}) — ~${daysLeft} dia(s) restante(s)`);

  try {
    const result = await runWarmupSession(account, (msg) => makeLog('info', email, `${email}: ${msg}`));

    if (!result.success) {
      if (result.error?.includes('checkpoint')) {
        updateAccount(id, { status: 'checkpoint', error: 'Google pediu verificação' });
        makeLog('warn', email, `⚠️ ${email}: Checkpoint detectado — verificação manual necessária.`);
        return;
      }
      updateAccount(id, { error: result.error });
      makeLog('error', email, `${email}: Falha: ${result.error}`);
      return;
    }

    updateAccount(id, {
      lastWarmupAt: new Date().toISOString(),
      warmupDaysDone: (account.warmupDaysDone || 0) + 1,
    });
    makeLog('success', email, `${email}: Sessão concluída. ~${daysLeft} dia(s) restante(s).`);
  } catch (err) {
    makeLog('error', email, `${email}: Erro na sessão: ${err.message}`);
    updateAccount(id, { error: err.message });
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
