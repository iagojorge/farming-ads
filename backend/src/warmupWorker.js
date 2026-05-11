import { runWarmupSession, runGoogleAdsOnly, openChromeForTesting, runMCCCreation } from './warmupEngine.js';
import { TIMINGS } from './warmupTimings.js';
import { getAccountsByStatus, getAccounts, updateAccount, addLog } from './store.js';
import { broadcast } from './events.js';

let isRunning = false;
let isGoogleAdsRunning = false;
let isOpenChromeRunning = false;
let isMCCRunning = false;
let shouldStopWarmup = false;
let shouldStopGoogleAds = false;
let shouldStopMCC = false;
let activePeriodWarmups = new Map(); // period → { accounts: [...], startTime }
let openChromeSessions = new Map(); // accountId → { email, close }

export function stopMCCWorker() {
  if (isMCCRunning) {
    shouldStopMCC = true;
    makeLog('warn', null, 'MCC: Solicitação de parada recebida.');
  }
}

export async function runMCCForAccounts(accountIds) {
  if (isMCCRunning) {
    makeLog('warn', null, 'MCC: Fluxo já em execução, ignorando pedido.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'MCC: Nenhuma conta selecionada.');
    return;
  }

  isMCCRunning = true;
  shouldStopMCC = false;
  broadcast('warmup-status', { isMCCRunning: true });

  try {
    const allAccounts = getAccounts();
    const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

    if (accounts.length === 0) {
      makeLog('warn', null, 'MCC: Nenhuma conta encontrada para os IDs fornecidos.');
      return;
    }

    makeLog('info', null, `MCC: Iniciando fluxo para ${accounts.length} conta(s)`);

    await Promise.all(accounts.map(async (account) => {
      if (shouldStopMCC) return;

      const { id, email } = account;
      updateAccount(id, { warmupStatus: 'warming', warmupCurrentStep: 'mcc' });
      broadcast('account-update', { id, warmupStatus: 'warming', warmupCurrentStep: 'mcc' });

      try {
        const result = await runMCCCreation(account, (msg) => {
          makeLog('info', email, `${email}: ${msg}`);
        });

        const update = { warmupStatus: 'idle', warmupCurrentStep: 'done' };
        if (result.success) {
          if (result.mccAccountId) update.googleAdsAccountId = result.mccAccountId;
          updateAccount(id, update);
          makeLog('success', email, `✅ ${email}: MCC concluído.${result.mccAccountId ? ` ID: ${result.mccAccountId}` : ''}`);
        } else {
          update.warmupCurrentStep = 'error';
          updateAccount(id, update);
          makeLog('error', email, `${email}: MCC falhou — ${result.error || 'erro desconhecido'}`);
        }
        broadcast('account-update', { id, ...update });
      } catch (err) {
        updateAccount(id, { warmupStatus: 'idle', warmupCurrentStep: 'error' });
        makeLog('error', email, `${email}: Erro MCC: ${err.message}`);
        broadcast('account-update', { id, warmupStatus: 'idle', warmupCurrentStep: 'error' });
      }
    }));

    makeLog('info', null, 'MCC: Fluxo finalizado.');
  } finally {
    isMCCRunning = false;
    shouldStopMCC = false;
    broadcast('warmup-status', { isMCCRunning: false });
  }
}

export function getWarmupWorkerStatus() {
  return { 
    isRunning,
    isGoogleAdsRunning,
    isMCCRunning,
    isOpenChromeRunning,
    openChromeCount: openChromeSessions.size,
    openChromeAccounts: Array.from(openChromeSessions.values()).map((session) => session.email),
    activePeriods: Array.from(activePeriodWarmups.entries()).map(([period, data]) => ({
      period,
      accountsCount: data.accounts?.length,
      startTime: data.startTime,
    })),
  };
}

export function stopWarmupWorker() {
  if (isRunning) {
    shouldStopWarmup = true;
    makeLog('warn', null, 'Warmup: Solicitação de parada recebida.');
  }
}

export function stopGoogleAdsWorker() {
  if (isGoogleAdsRunning) {
    shouldStopGoogleAds = true;
    makeLog('warn', null, 'Google Ads: Solicitação de parada recebida.');
  }
}

async function closeOpenChromeSessions() {
  const sessions = Array.from(openChromeSessions.values());
  openChromeSessions.clear();

  if (sessions.length > 0) {
    await Promise.allSettled(sessions.map((session) => session.close()));
  }

  isOpenChromeRunning = false;
  broadcast('warmup-status', { isOpenChromeRunning: false, openChromeCount: 0 });
}

export async function stopOpenChromeWorker() {
  if (!isOpenChromeRunning && openChromeSessions.size === 0) return;

  makeLog('warn', null, 'Abrir Chrome: Solicitação de parada recebida.');
  await closeOpenChromeSessions();
  makeLog('info', null, 'Abrir Chrome: Sessões encerradas.');
}

export async function runOpenChromeForAccounts(accountIds) {
  if (isOpenChromeRunning) {
    makeLog('warn', null, 'Abrir Chrome: Já existem sessões abertas. Feche as atuais antes de iniciar novas.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'Abrir Chrome: Nenhuma conta selecionada.');
    return;
  }

  const allAccounts = getAccounts();
  const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

  if (accounts.length === 0) {
    makeLog('warn', null, 'Abrir Chrome: Nenhuma conta encontrada para os IDs fornecidos.');
    return;
  }

  isOpenChromeRunning = true;
  broadcast('warmup-status', { isOpenChromeRunning: true, openChromeCount: 0 });
  makeLog('info', null, `Abrir Chrome: Iniciando ${accounts.length} conta(s) sem timeout.`);

  const results = await Promise.allSettled(accounts.map(async (account) => {
    const { id, email } = account;

    const session = await openChromeForTesting(account, (msg) => {
      makeLog('info', email, `${email}: ${msg}`);
    });

    openChromeSessions.set(id, { email, close: session.close });

    session.context.once('close', () => {
      const removed = openChromeSessions.delete(id);
      if (!removed) return;

      makeLog('info', email, `${email}: Chrome de teste fechado.`);

      if (openChromeSessions.size === 0) {
        isOpenChromeRunning = false;
        broadcast('warmup-status', { isOpenChromeRunning: false, openChromeCount: 0 });
      } else {
        broadcast('warmup-status', { isOpenChromeRunning: true, openChromeCount: openChromeSessions.size });
      }
    });

    broadcast('warmup-status', { isOpenChromeRunning: true, openChromeCount: openChromeSessions.size });
  }));

  const opened = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - opened;

  if (opened > 0) {
    makeLog('success', null, `Abrir Chrome: ${opened} conta(s) aberta(s) para teste sem timeout.`);
  }

  if (failed > 0) {
    const firstError = results.find((r) => r.status === 'rejected');
    makeLog('error', null, `Abrir Chrome: ${failed} conta(s) falharam ao abrir. ${firstError?.reason?.message || ''}`.trim());
  }

  if (openChromeSessions.size === 0) {
    isOpenChromeRunning = false;
    broadcast('warmup-status', { isOpenChromeRunning: false, openChromeCount: 0 });
  }
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

function getWarmupDaysDone(account) {
  return Number(account?.warmupDaysDone || 0);
}

/**
 * Ajusta consistência de status de aquecimento com base em warmupDaysDone.
 */
export function checkExpiredWarmups() {
  const allAccounts = getAccounts();
  let count = 0;

  for (const account of allAccounts) {
    const daysDone = getWarmupDaysDone(account);

    if (account.status === 'warming' && daysDone >= TIMINGS.warmupDays) {
      updateAccount(account.id, { status: 'ready_for_ads', warmupStatus: 'completed', warmupProgress: 100 });
      makeLog('success', account.email, `🎉 ${account.email}: ${TIMINGS.warmupDays} dias de aquecimento concluídos! Pronta para Google Ads.`);
      broadcast('account-update', { id: account.id, status: 'ready_for_ads', warmupStatus: 'completed', warmupProgress: 100 });
      count++;
      continue;
    }

    if (account.status === 'ready_for_ads' && daysDone < TIMINGS.warmupDays) {
      const progress = Math.min(100, Math.round((daysDone / TIMINGS.warmupDays) * 100));
      updateAccount(account.id, { status: 'warming', warmupStatus: 'idle', warmupProgress: progress });
      makeLog('warn', account.email, `⚠️ ${account.email}: Status corrigido para aquecimento (${daysDone}/${TIMINGS.warmupDays} dias).`);
      broadcast('account-update', { id: account.id, status: 'warming', warmupStatus: 'idle', warmupProgress: progress });
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
 * NÃO reseta dias se conta já completou — os dias acumulam.
 */
export function startWarmup(accountId) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + TIMINGS.warmupDays);

  // Se a conta já estava ready_for_ads, manter os dias acumulados
  const account = getAccounts().find((a) => a.id === accountId);
  const currentDaysDone = account && account.status === 'ready_for_ads' ? (account.warmupDaysDone || 0) : 0;

  return updateAccount(accountId, {
    status: 'warming',
    warmupStartDate: now.toISOString(),
    warmupEndDate: end.toISOString(),
    warmupDaysDone: currentDaysDone,
    warmupStatus: 'idle',
  });
}

/**
 * Executa uma sessão de aquecimento para uma conta individual (Playwright).
 */
async function runSingleWarmup(account) {
  const { id, email } = account;

  // Garante status warming apenas para contas ainda em progresso.
  const currentAccount = getAccounts().find((a) => a.id === id);
  if (currentAccount && currentAccount.status !== 'warming' && currentAccount.status !== 'ready_for_ads') {
    startWarmup(id);
    const updatedAccount = getAccounts().find((a) => a.id === id);
    const currentDays = updatedAccount?.warmupDaysDone || 0;
    broadcast('account-update', { id, status: 'warming', warmupStartDate: new Date().toISOString(), warmupDaysDone: currentDays });
  }

  // Atualiza status de sessão para warming
  updateAccount(id, { warmupStatus: 'warming', warmupStartTime: new Date().toISOString() });
  broadcast('account-update', { id, warmupStatus: 'warming' });

  // IMPORTANTE: Recarrega account do store para ter dados frescos
  let freshAccount = getAccounts().find((a) => a.id === id);
  if (!freshAccount) {
    makeLog('error', email, `${email}: Conta não encontrada ao recarregar`);
    return;
  }

  const currentDaysDone = getWarmupDaysDone(freshAccount);

  // Promove para ready apenas por progresso real de dias.
  if (freshAccount.status !== 'ready_for_ads' && currentDaysDone >= TIMINGS.warmupDays) {
    updateAccount(id, { status: 'ready_for_ads', warmupStatus: 'completed' });
    makeLog('success', email, `🎉 ${email}: Aquecimento concluído! Pronta para Google Ads.`);
    broadcast('account-update', { id, status: 'ready_for_ads', warmupStatus: 'completed' });
    return;
  }

  const daysLeft = Math.max(0, TIMINGS.warmupDays - currentDaysDone);
  const requestedDay = currentDaysDone + 1;
  const maintenanceDay = Math.max(2, TIMINGS.warmupDays - 1);
  const sessionDayNumber = freshAccount.status === 'ready_for_ads' ? maintenanceDay : requestedDay;

  makeLog('info', email, `${email}: Iniciando sessão de aquecimento (dia ${requestedDay}) — ~${daysLeft} dia(s) restante(s)`);

  try {
    // Atualiza step para gmail
    const updateStep = (step) => {
      updateAccount(id, { warmupCurrentStep: step });
      broadcast('account-update', { id, warmupCurrentStep: step });
    };

    // Timeout é tratado internamente pelo warmupEngine (fecha browser ao travar)
    const result = await runWarmupSession(freshAccount, (msg) => {
      makeLog('info', email, `${email}: ${msg}`);
      if (msg.includes('Gmail') || msg.includes('email')) updateStep('gmail');
      if (msg.includes('YouTube')) updateStep('youtube');
      if (msg.includes('Globo')) updateStep('globo');
    }, sessionDayNumber);

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

    // Se completou todos os dias, marca como pronta para ads
    if (newDaysDone >= TIMINGS.warmupDays) {
      const accountUpdate = {
        lastWarmupAt: new Date().toISOString(),
        warmupDaysDone: newDaysDone,
        warmupProgress: 100,
        warmupStatus: 'completed',
        warmupCurrentStep: 'done',
        status: 'ready_for_ads',
      };
      // Salva API key se foi gerada
      if (result.googleAdsApiKey) {
        accountUpdate.googleAdsApiKey = result.googleAdsApiKey;
      }
      if (result.googleAdsAccountId) {
        accountUpdate.googleAdsAccountId = result.googleAdsAccountId;
      }
      updateAccount(id, accountUpdate);
      makeLog('success', email, `🎉 ${email}: Aquecimento completo! ${newDaysDone}/${TIMINGS.warmupDays} dias — Pronta para Google Ads.${result.googleAdsApiKey ? ' API Key gerada.' : ''}`);
      broadcast('account-update', { id, ...accountUpdate });
    } else {
      updateAccount(id, {
        lastWarmupAt: new Date().toISOString(),
        warmupDaysDone: newDaysDone,
        warmupProgress: progress,
        warmupStatus: 'idle',
        warmupCurrentStep: 'done',
      });
      makeLog('success', email, `${email}: Sessão concluída. Dia ${newDaysDone}/${TIMINGS.warmupDays}. ~${daysLeft} dia(s) restante(s).`);
      broadcast('account-update', { id, warmupDaysDone: newDaysDone, warmupProgress: progress, warmupStatus: 'idle', warmupCurrentStep: 'done' });
    }
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
  const periodAccounts = allAccounts.filter((a) => a.schedulePeriod === period && (a.status === 'warming' || a.status === 'ready_for_ads'));

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

    if (shouldStopWarmup) {
      makeLog('warn', null, `Período ${period}: Parado pelo usuário.`);
      return;
    }

    await Promise.all(toWarm.map((a) => runSingleWarmup(a)));

    makeLog('info', null, `Período ${period}: Ciclo de aquecimento finalizado (${toWarm.length} conta(s))`);
  } finally {
    activePeriodWarmups.delete(period);
    broadcast('warming-status', { isRunning: false, period });
  }
}

/**
 * Executa APENAS o fluxo Google Ads + API Key para contas selecionadas.
 */
export async function runGoogleAdsForAccounts(accountIds) {
  if (isGoogleAdsRunning) {
    makeLog('warn', null, 'Fluxo Google Ads já em execução, ignorando pedido.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'Nenhuma conta selecionada para Google Ads.');
    return;
  }

  isGoogleAdsRunning = true;
  shouldStopGoogleAds = false;
  broadcast('warmup-status', { isGoogleAdsRunning: true });

  try {
    const allAccounts = getAccounts();
    const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

    if (accounts.length === 0) {
      makeLog('warn', null, 'Nenhuma conta encontrada para os IDs fornecidos.');
      return;
    }

    makeLog('info', null, `Google Ads: Iniciando fluxo para ${accounts.length} conta(s) (aquecimento pode continuar em paralelo)`);

    if (shouldStopGoogleAds) {
      makeLog('warn', null, 'Google Ads: Parado pelo usuário.');
      return;
    }

    await Promise.all(accounts.map(async (account) => {
      const { id, email } = account;

      updateAccount(id, { warmupStatus: 'warming', warmupCurrentStep: 'google-ads' });
      broadcast('account-update', { id, warmupStatus: 'warming', warmupCurrentStep: 'google-ads' });

      try {
        // Timeout tratado internamente pelo warmupEngine
        const result = await runGoogleAdsOnly(account, (msg) => {
          makeLog('info', email, `${email}: ${msg}`);
        });

        if (result.success) {
          const update = { warmupStatus: 'idle', warmupCurrentStep: 'done' };
          if (result.googleAdsApiKey) update.googleAdsApiKey = result.googleAdsApiKey;
          if (result.googleAdsAccountId) update.googleAdsAccountId = result.googleAdsAccountId;
          updateAccount(id, update);
          const keyMsg = result.googleAdsApiKey ? ` API Key: ${result.googleAdsApiKey.slice(0, 10)}...` : ' (sem API Key)';
          const idMsg  = result.googleAdsAccountId ? ` Ads ID: ${result.googleAdsAccountId}` : '';
          makeLog('success', email, `✅ ${email}: Google Ads concluído.${idMsg}${keyMsg}`);
          broadcast('account-update', { id, ...update });
        } else {
          const errMsg = result.error || 'Falha no fluxo Google Ads';
          // Mesmo em erro, salva o Ads ID se foi capturado antes da falha
          const update = { warmupStatus: 'idle', warmupCurrentStep: 'error' };
          if (result.googleAdsAccountId) update.googleAdsAccountId = result.googleAdsAccountId;
          updateAccount(id, update);
          makeLog('error', email, `${email}: Google Ads falhou — ${errMsg}`);
          broadcast('account-update', { id, ...update });
        }
      } catch (err) {
        updateAccount(id, { warmupStatus: 'idle', warmupCurrentStep: 'error' });
        makeLog('error', email, `${email}: Erro Google Ads: ${err.message}`);
        broadcast('account-update', { id, warmupStatus: 'idle', warmupCurrentStep: 'error' });
      }
    }));

    makeLog('info', null, 'Google Ads: Fluxo finalizado.');
  } finally {
    isGoogleAdsRunning = false;
    shouldStopGoogleAds = false;
    broadcast('warmup-status', { isGoogleAdsRunning: false });
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

    // Garante que contas ainda não prontas sejam marcadas como warming antes de executar.
    // Contas ready_for_ads devem permanecer ready e rodar em modo de manutenção.
    for (const account of accounts) {
      if (account.status === 'pending' || account.status === 'synced' || account.status === 'error') {
        startWarmup(account.id);
        const updatedAccount = getAccounts().find((a) => a.id === account.id);
        const currentDays = updatedAccount?.warmupDaysDone || 0;
        makeLog('info', account.email, `${account.email}: Status atualizado para aquecimento (${TIMINGS.warmupDays} dias). Dias acumulados: ${currentDays}`);
        broadcast('account-update', {
          id: account.id,
          status: 'warming',
          warmupStartDate: new Date().toISOString(),
          warmupDaysDone: currentDays,
          warmupStatus: 'idle',
        });
      } else if (account.status === 'ready_for_ads') {
        makeLog('info', account.email, `${account.email}: Conta pronta selecionada — executando aquecimento contínuo em modo de manutenção.`);
      }
    }

    makeLog('info', null, `Aquecimento manual iniciado para ${accounts.length} conta(s)`);

    if (shouldStopWarmup) {
      makeLog('warn', null, 'Aquecimento manual: Parado pelo usuário.');
      return;
    }

    await Promise.all(accounts.map((a) => runSingleWarmup(a)));

    makeLog('info', null, 'Aquecimento manual finalizado.');
  } finally {
    isRunning = false;
    shouldStopWarmup = false;
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
    // Corrige inconsistências de status antes de iniciar o ciclo.
    const adjusted = checkExpiredWarmups();
    if (adjusted > 0) {
      makeLog('info', null, `${adjusted} conta(s) tiveram status de aquecimento ajustado.`);
    }

    // Inicia aquecimento de contas pendentes automaticamente
    const pending = getAccountsByStatus('pending');
    for (const account of pending) {
      startWarmup(account.id);
      makeLog('info', account.email, `${account.email}: Aquecimento iniciado (${TIMINGS.warmupDays} dias).`);
    }

    const accounts = getAccounts().filter((a) => a.status === 'warming' || a.status === 'ready_for_ads');

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

    if (shouldStopWarmup) {
      makeLog('warn', null, 'Ciclo de aquecimento: Parado pelo usuário.');
      return;
    }

    await Promise.all(toWarm.map((a) => runSingleWarmup(a)));

    makeLog('info', null, 'Ciclo de aquecimento finalizado.');
  } finally {
    isRunning = false;
    shouldStopWarmup = false;
    broadcast('warmup-status', { isRunning: false });
  }
}
