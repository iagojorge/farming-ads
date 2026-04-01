import { runWarmupSession } from './warmupEngine.js';
import { TIMINGS } from './warmupTimings.js';
import { getSettings, getAccountsByStatus, getAccounts, updateAccount, addLog } from './store.js';
import { broadcast, getConnectedClients } from './events.js';

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
 * IMPORTANTE: Limpa contas travadas em estado "warming" que não estão rodando.
 * Isso evita que contas fiquem mostrando "aquecendo agora" indefinidamente.
 * Chamado periodicamente pelo scheduler.
 */
export function cleanupStuckWarmingAccounts() {
  if (isRunning) return; // Não limpar enquanto worker está rodando

  const allAccounts = getAccounts();
  let count = 0;

  for (const account of allAccounts) {
    if (account.warmupStatus === 'warming') {
      // Se é warming mas worker não está rodando, resetar
      updateAccount(account.id, { warmupStatus: 'idle' });
      makeLog('info', account.email, `Resetando conta ${account.email} de warming para idle (worker não estava ativo)`);
      broadcast('account-update', { id: account.id, warmupStatus: 'idle' });
      count++;
    }

    // Também verifica se a sessão está muito antiga (>2 horas)
    if (account.warmupStartTime && account.warmupStatus === 'warming') {
      const startTime = new Date(account.warmupStartTime);
      const elapsed = Date.now() - startTime.getTime();
      const maxDuration = 2 * 60 * 60 * 1000; // 2 horas

      if (elapsed > maxDuration) {
        updateAccount(account.id, { warmupStatus: 'idle' });
        makeLog('warn', account.email, `⏱️ Sessão de ${account.email} travada por >2h, resetando para idle`);
        broadcast('account-update', { id: account.id, warmupStatus: 'idle' });
        count++;
      }
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

  // IMPORTANTE: Recarrega account do store para ter dados frescos
  let freshAccount = getAccounts().find((a) => a.id === id);
  if (!freshAccount) {
    makeLog('error', email, `${email}: Conta não encontrada ao recarregar`);
    return;
  }

  // Verifica se o período já expirou
  if (freshAccount.warmupEndDate && new Date(freshAccount.warmupEndDate) <= new Date()) {
    updateAccount(id, { status: 'ready_for_ads', warmupStatus: 'completed' });
    makeLog('success', email, `🎉 ${email}: Aquecimento concluído! Pronta para Google Ads.`);
    broadcast('account-update', { id, status: 'ready_for_ads', warmupStatus: 'completed' });
    return;
  }

  const daysLeft = freshAccount.warmupEndDate
    ? Math.max(0, Math.ceil((new Date(freshAccount.warmupEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : '?';

  makeLog('info', email, `${email}: Iniciando sessão de aquecimento (dia ${(freshAccount.warmupDaysDone || 0) + 1}) — ~${daysLeft} dia(s) restante(s)`);

  try {
    // Atualiza step para gmail
    const updateStep = (step) => {
      updateAccount(id, { warmupCurrentStep: step });
      broadcast('account-update', { id, warmupCurrentStep: step });
    };

    const result = await runWarmupSession(freshAccount, (msg) => {
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
      // IMPORTANTE: Se falhar, ainda marca como tentado (não reseta completamente)
      updateAccount(id, { error: result.error, warmupStatus: 'idle', warmupCurrentStep: 'error' });
      makeLog('error', email, `${email}: Falha: ${result.error}`);
      broadcast('account-update', { id, error: result.error, warmupStatus: 'idle' });
      return;
    }

    // IMPORTANTE: Recarrega account novamente ANTES de atualizar progresso
    freshAccount = getAccounts().find((a) => a.id === id) || freshAccount;

    // Calcula progresso com base na conta atualizada
    const newDaysDone = (freshAccount.warmupDaysDone || 0) + 1;
    const progress = Math.min(100, Math.round((newDaysDone / TIMINGS.warmupDays) * 100));

    updateAccount(id, {
      lastWarmupAt: new Date().toISOString(),
      warmupDaysDone: newDaysDone,
      warmupProgress: progress,
      warmupStatus: 'idle',
      warmupCurrentStep: 'done',
    });
    makeLog('success', email, `${email}: Sessão concluída. Dia ${newDaysDone}/${TIMINGS.warmupDays}. ~${daysLeft} dia(s) restante(s).`);
    broadcast('account-update', { id, warmupDaysDone: newDaysDone, warmupProgress: progress, warmupStatus: 'idle', warmupCurrentStep: 'done' });
  } catch (err) {
    makeLog('error', email, `${email}: Erro na sessão: ${err.message}`);
    updateAccount(id, { error: err.message, warmupStatus: 'idle', warmupCurrentStep: 'error' });
    broadcast('account-update', { id, error: err.message, warmupStatus: 'idle', warmupCurrentStep: 'error' });
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
/**
 * Aquece contas específicas por ID (seleção manual)
 */
export async function runWarmupForSelectedAccounts(accountIds) {
  if (isRunning) {
    makeLog('warn', null, 'Ciclo já em execução, ignorando.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'Nenhuma conta selecionada para aquecimento.');
    return;
  }

  isRunning = true;
  broadcast('warmup-status', { isRunning: true });

  try {
    const allAccounts = getAccounts();
    const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

    if (accounts.length === 0) {
      makeLog('warn', null, 'Nenhuma conta encontrada para os IDs fornecidos.');
      return;
    }

    makeLog('info', null, `Aquecimento manual iniciado para ${accounts.length} conta(s)`);

    const concurrency = Math.max(1, getSettings().concurrentBrowsers || TIMINGS.concurrentBrowsers);

    for (let i = 0; i < accounts.length; i += concurrency) {
      // Verifica se ainda há clientes conectados
      if (getConnectedClients() === 0) {
        makeLog('warn', null, 'Conexão de navegador perdida — parando aquecimento.');
        break;
      }
      const batch = accounts.slice(i, i + concurrency);
      await Promise.all(batch.map((a) => runSingleWarmup(a)));
    }

    makeLog('info', null, 'Aquecimento manual finalizado.');
  } finally {
    isRunning = false;
    broadcast('warmup-status', { isRunning: false });
  }
}

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
      // Verifica se ainda há clientes conectados
      if (getConnectedClients() === 0) {
        makeLog('warn', null, 'Conexão de navegador perdida — parando aquecimento.');
        break;
      }
      const batch = toWarm.slice(i, i + concurrency);
      await Promise.all(batch.map((a) => runSingleWarmup(a)));
    }

    makeLog('info', null, 'Ciclo de aquecimento finalizado.');
  } finally {
    isRunning = false;
    broadcast('warmup-status', { isRunning: false });
  }
}
