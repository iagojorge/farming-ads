import { startBrowser, stopBrowser } from './adspower.js';
import { getSettings, getWarmingAccounts, updateAccount, addLog } from './store.js';
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
 * Verifica contas cujo período de aquecimento expirou e as marca como aquecidas.
 */
export function checkExpiredWarmups() {
  const now = new Date();
  const warming = getWarmingAccounts();
  let count = 0;

  for (const account of warming) {
    if (account.warmupEndDate && new Date(account.warmupEndDate) <= now) {
      const days = getSettings().warmupDays;
      updateAccount(account.id, { warmupStatus: 'warmed', status: 'warmed' });
      makeLog('success', account.email, `🎉 ${account.email}: ${days} dias de aquecimento concluídos! Conta marcada como aquecida.`);
      count++;
    }
  }

  return count;
}

/**
 * Executa uma sessão de aquecimento para uma conta.
 */
async function runSingleWarmup(account, settings) {
  const { id, email, profileId } = account;

  // Verifica se o período já expirou
  if (account.warmupEndDate && new Date(account.warmupEndDate) <= new Date()) {
    updateAccount(id, { warmupStatus: 'warmed', status: 'warmed' });
    makeLog('success', email, `🎉 ${email}: Aquecimento concluído! Conta marcada como aquecida.`);
    return;
  }

  const sessionMin = settings.warmupSessionMinutes ?? 30;
  const daysLeft = account.warmupEndDate
    ? Math.max(0, Math.ceil((new Date(account.warmupEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : '?';

  makeLog('info', email, `${email}: Iniciando sessão de aquecimento (${sessionMin} min) — ~${daysLeft} dia(s) restante(s)`);

  try {
    // Abre o browser (RPA executa automaticamente se configurado como ação automática no AdsPower)
    await startBrowser(profileId);

    // Aguarda a duração da sessão
    await new Promise((r) => setTimeout(r, sessionMin * 60 * 1_000));

    // Fecha o browser
    await stopBrowser(profileId);

    updateAccount(id, { lastWarmupAt: new Date().toISOString() });
    makeLog('success', email, `${email}: Sessão concluída. ~${daysLeft} dia(s) restante(s).`);
  } catch (err) {
    makeLog('error', email, `${email}: Erro na sessão de aquecimento: ${err.message}`);
    try { await stopBrowser(profileId); } catch { /* ignora */ }
  }
}

/**
 * Executa o ciclo de aquecimento para todas as contas em aquecimento ativo.
 */
export async function runWarmupCycle() {
  if (isRunning) {
    makeLog('warn', null, 'Ciclo já em execução, ignorando.');
    return;
  }

  isRunning = true;
  broadcast('warmup-status', { isRunning: true });

  const settings = getSettings();

  // Marca expirados antes
  const expired = checkExpiredWarmups();
  if (expired > 0) {
    makeLog('info', null, `${expired} conta(s) marcadas como aquecidas.`);
  }

  const accounts = getWarmingAccounts();

  if (accounts.length === 0) {
    makeLog('info', null, 'Nenhuma conta em aquecimento ativo no momento.');
    isRunning = false;
    broadcast('warmup-status', { isRunning: false });
    return;
  }

  makeLog('info', null, `Iniciando ciclo de aquecimento para ${accounts.length} conta(s)`);

  const concurrency = Math.max(1, settings.concurrentProfiles || 1);

  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    await Promise.all(batch.map((a) => runSingleWarmup(a, settings)));
  }

  makeLog('info', null, 'Ciclo de aquecimento finalizado.');
  isRunning = false;
  broadcast('warmup-status', { isRunning: false });
}
