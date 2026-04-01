import { getSettings, getAccounts, updateAccount } from './store.js';
import { broadcast } from './events.js';

// ── Estado ──────────────────────────────────────────────────
const activeJobs = new Map(); // accountId → { email, status }
let isRunning = false;
let stopRequested = false;

export function getLoginWorkerStatus() {
  return {
    isRunning,
    jobs: Array.from(activeJobs.entries()).map(([id, info]) => ({ id, ...info })),
  };
}

function setJobStatus(accountId, email, status) {
  activeJobs.set(accountId, { email, status, updatedAt: new Date().toISOString() });
  broadcast('login-status', getLoginWorkerStatus());
  broadcast('log', {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: status.startsWith('erro') ? 'error' : status === 'concluído' ? 'success' : 'info',
    profileId: null,
    profileName: `Login – ${email}`,
    message: `[Login] ${email}: ${status}`,
    timestamp: new Date().toISOString(),
  });
}

// ── Login de uma conta ───────────────────────────────────────
async function loginSingleAccount(account) {
  const { id, email } = account;

  try {
    setJobStatus(id, email, 'erro: Sistema de login será implementado na próxima fase');
    updateAccount(id, { status: 'error', error: 'Login worker temporariamente desabilitado durante migração do AdsPower' });
  } catch (err) {
    setJobStatus(id, email, `erro: ${err.message}`);
    updateAccount(id, { status: 'error', error: err.message });
  }
}

// ── API pública ──────────────────────────────────────────────
/**
 * Executa login automático para as contas indicadas (ou todas as pendentes/com erro).
 * @param {string[]|null} accountIds - null = todas pendentes/erro
 */
export async function runLoginAccounts(accountIds = null) {
  if (isRunning) throw new Error('Login worker já está em execução');

  isRunning = true;
  stopRequested = false;
  broadcast('login-status', getLoginWorkerStatus());

  try {
    const all = getAccounts();
    let targets = all.filter((a) => a.status === 'pending' || a.status === 'error');
    if (accountIds?.length) {
      targets = all.filter((a) => accountIds.includes(a.id));
    }

    if (targets.length === 0) {
      broadcast('log', {
        id: Date.now().toString(),
        type: 'warn',
        profileId: null,
        profileName: null,
        message: '[Login] Nenhuma conta selecionada para login',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    broadcast('log', {
      id: Date.now().toString(),
      type: 'info',
      profileId: null,
      profileName: null,
      message: `[Login] Iniciando login para ${targets.length} conta(s)`,
      timestamp: new Date().toISOString(),
    });

    // Processar uma por vez para evitar bloqueio do Google
    for (const account of targets) {
      if (stopRequested) break;
      await loginSingleAccount(account);
      if (!stopRequested) await new Promise((r) => setTimeout(r, 2000));
    }

    broadcast('log', {
      id: Date.now().toString(),
      type: 'info',
      profileId: null,
      profileName: null,
      message: `[Login] Processo finalizado${stopRequested ? ' (interrompido)' : ''}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    isRunning = false;
    activeJobs.clear();
    broadcast('login-status', getLoginWorkerStatus());
  }
}

export function stopLoginWorker() {
  stopRequested = true;
}
