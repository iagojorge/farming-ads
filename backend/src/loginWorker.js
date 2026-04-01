import puppeteer from 'puppeteer-core';
import { createProfile, startBrowser, stopBrowser, listProfiles } from './adspower.js';
import { getSettings, getAccounts, updateAccount, upsertProfiles } from './store.js';
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
  const { id, email, password } = account;
  let profileId = account.profileId;
  let browser = null;

  try {
    // 1. Criar perfil se não tiver
    if (!profileId) {
      setJobStatus(id, email, 'criando perfil no AdsPower');
      const profileName = `Farming – ${email.split('@')[0]}`;
      try {
        profileId = await createProfile(profileName, {
          proxy: account.proxy,
          email: account.email,
          password: account.password,
        });
        updateAccount(id, { profileId, status: 'logging-in' });
        // Sincroniza o novo perfil com o store local
        const adsList = await listProfiles();
        upsertProfiles(adsList);
      } catch (createErr) {
        throw new Error(`Não foi possível criar perfil: ${createErr.message}`);
      }
    } else {
      updateAccount(id, { status: 'logging-in' });
    }

    // 2. Inicia browser no AdsPower
    setJobStatus(id, email, 'abrindo browser');
    const browserData = await startBrowser(profileId);
    const wsUrl = browserData?.ws?.puppeteer;
    if (!wsUrl) throw new Error('AdsPower não retornou websocket URL. Verifique se o AdsPower está aberto.');

    // 3. Conecta puppeteer ao browser do AdsPower
    setJobStatus(id, email, 'conectando ao browser');
    browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(20000);

    // 4. Navega para login do Google
    setJobStatus(id, email, 'abrindo accounts.google.com');
    await page.goto('https://accounts.google.com/signin/v2/identifier?hl=pt-BR', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // 5. Digita o email
    setJobStatus(id, email, 'digitando email');
    const emailInput = await page.waitForSelector('input[type="email"]', { visible: true, timeout: 15000 });
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email, { delay: 80 });
    await page.keyboard.press('Enter');

    // 6. Aguarda campo de senha aparecer
    setJobStatus(id, email, 'aguardando campo de senha');
    const passwordInput = await page.waitForSelector('input[type="password"]', {
      visible: true,
      timeout: 20000,
    });

    // 7. Digita a senha
    setJobStatus(id, email, 'digitando senha');
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(password, { delay: 80 });
    await page.keyboard.press('Enter');

    // 8. Aguarda redirecionamento pós-login
    setJobStatus(id, email, 'aguardando login...');
    await new Promise((r) => setTimeout(r, 5000));

    const finalUrl = page.url();

    // 9. Detecta erros comuns
    if (finalUrl.includes('/signin/') || finalUrl.includes('/challenge/')) {
      const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      if (/senha incorreta|wrong password|incorrect|incorreta/i.test(bodyText)) {
        throw new Error('Senha incorreta');
      }
      if (/verificação|verify|challenge/i.test(finalUrl)) {
        throw new Error('Verificação de segurança necessária — faça o login manualmente na primeira vez');
      }
      throw new Error(`Login não concluído (redirecionado para: ${finalUrl})`);
    }

    // 10. Aguarda mais tempo para persistir cookies na sessão do AdsPower
    setJobStatus(id, email, 'salvando sessão no AdsPower...');
    await new Promise((r) => setTimeout(r, 10000)); // 10 segundos para salvar

    // 11. Inicia o aquecimento automático
    setJobStatus(id, email, 'concluído — iniciando aquecimento');
    const { warmupDays } = getSettings();
    const warmupStartDate = new Date().toISOString();
    const warmupEndDate = new Date(Date.now() + warmupDays * 24 * 60 * 60 * 1000).toISOString();
    updateAccount(id, {
      status: 'warming',
      warmupStartDate,
      warmupEndDate,
      completedAt: new Date().toISOString(),
      error: null,
    });

  } catch (err) {
    setJobStatus(id, email, `erro: ${err.message}`);
    updateAccount(id, { status: 'error', error: err.message });
  } finally {
    // Desconecta puppeteer sem fechar o browser (AdsPower vai salvar a sessão)
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignora */ }
    }
    // Para o browser POR SEGURANÇA (salva todos os dados de sessão/cookies)
    if (profileId) {
      try { 
        await new Promise((r) => setTimeout(r, 3000)); // espera mais um pouco antes de parar
        await stopBrowser(profileId);
      } catch { /* ignora */ }
    }
    activeJobs.delete(id);
    broadcast('login-status', getLoginWorkerStatus());
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
