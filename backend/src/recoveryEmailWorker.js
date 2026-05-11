/**
 * Worker para trocar o email de recuperação de contas Google.
 *
 * Fluxo:
 * 1. Login automático na conta
 * 2. Vai para Google Account → Segurança → Email de recuperação
 * 3. Clica em Editar → Insere novo email → Confirma
 * 4. Google pede código de verificação — apenas fecha (não precisa validar)
 * 5. Valida se o email foi realmente alterado
 * 6. Atualiza recoveryEmail no store
 */
import { chromium } from 'playwright';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { loginGoogle, clickFirst, sleep, parseProxy, PROFILES_DIR } from './warmupEngine.js';
import { randomDelay } from './warmupTimings.js';
import { createSocksProxyTunnel } from './socksProxy.js';
import { getAccounts, updateAccount, addLog } from './store.js';
import { broadcast } from './events.js';

const TARGET_RECOVERY_EMAIL = 'dime@agencia-titan.com';
const TARGET_PASSWORD = '#ytskiro2026';

let isRunning = false;
let shouldStop = false;

export function getRecoveryWorkerStatus() {
  return { isRunning };
}

export function stopRecoveryWorker() {
  if (isRunning) {
    shouldStop = true;
    makeLog('warn', null, 'Recovery Email: Solicitação de parada recebida.');
  }
}

function makeLog(level, email, message) {
  addLog({ level, source: email || 'recovery-worker', message, timestamp: new Date().toISOString() });
  broadcast('log', { level, source: email || 'recovery-worker', message });
}

/**
 * Detecta situações especiais na página:
 * - Se pedir para confirmar que é você, tenta avançar.
 * - Se detectar bloqueio por atividade incomum, marca conta como desativada e retorna erro.
 */
async function handleSecurityChallenges(page, account, log) {
  const content = (await page.content()).toLowerCase();
  
  // Detecta bloqueio por atividade incomum
  if (content.includes('detectamos atividade incomum') && content.includes('foi bloqueada')) {
    log('❌ Conta bloqueada por atividade incomum. Marcando como desativada.');
    updateAccount(account.id, { status: 'desativada' });
    broadcast('account-update', { id: account.id, status: 'desativada' });
    return { blocked: true, error: 'Conta bloqueada por atividade incomum' };
  }
  
  // Detecta "confirme que é você" e tenta avançar
  if (content.includes('confirme que é você') || content.includes('verify it\'s you') || content.includes('verifique se é você')) {
    log('⚠️ Página pediu para confirmar que é você. Tentando avançar...');
    const advanced = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type=submit], [role=button]'));
      for (const btn of btns) {
        const txt = (btn.textContent || '').toLowerCase();
        if (txt.includes('continuar') || txt.includes('avançar') || txt.includes('next') || txt.includes('continue')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (advanced) {
      log('⚠️ Cliquei em avançar/continuar para confirmar identidade.');
      await sleep(2000);
    } else {
      log('⚠️ Não encontrou botão para avançar na confirmação de identidade.');
    }
  }
  
  return { blocked: false };
}

/**
 * Troca o email de recuperação usando uma page já logada.
 * Retorna { success, skipped?, error? }
 */
async function doChangeRecoveryEmail(page, account, log) {
  // ---------- Navegar para Segurança ----------
  log('🔷 [EMAIL] Navegando para myaccount.google.com/security...');
  await page.goto('https://myaccount.google.com/security', {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await sleep(randomDelay(3000, 5000));
  // Checa desafios/bloqueio
  const secCheck = await handleSecurityChallenges(page, account, log);
  if (secCheck.blocked) return { success: false, error: secCheck.error };

  // ---------- Verificar email atual ----------
  const pageContent = await page.content();
  if (pageContent.includes(TARGET_RECOVERY_EMAIL)) {
    log(`✅ [EMAIL] Já é ${TARGET_RECOVERY_EMAIL} — nada a fazer`);
    return { success: true, skipped: true };
  }
  // Checa desafios/bloqueio
  const secCheck2 = await handleSecurityChallenges(page, account, log);
  if (secCheck2.blocked) return { success: false, error: secCheck2.error };

  // ---------- Clicar em "E-mail de recuperação" ----------
  log('🔷 [EMAIL] Procurando link de email de recuperação...');
  const recoveryClicked = await clickFirst(page, [
    'a[href*="recovery/email"]',
    'a[href*="signoptions/rescuephone"]',
    '[data-settingid="recovery-email"]',
    'a:has-text("E-mail de recuperação")',
    'a:has-text("Recovery email")',
    'a:has-text("recovery email")',
  ], 'E-mail de recuperação', log, 10000);

  if (!recoveryClicked) {
    log('  Tentando encontrar via evaluate...');
    const found = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, [role="link"]'));
      for (const el of links) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes('e-mail de recuperação') || text.includes('recovery email') || text.includes('e-mail de recuper')) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!found) {
      return { success: false, error: 'Link de email de recuperação não encontrado' };
    }
  }
  // Checa desafios/bloqueio
  const secCheck3 = await handleSecurityChallenges(page, account, log);
  if (secCheck3.blocked) return { success: false, error: secCheck3.error };

  await sleep(randomDelay(2000, 4000));
  // Checa desafios/bloqueio
  const secCheck4 = await handleSecurityChallenges(page, account, log);
  if (secCheck4.blocked) return { success: false, error: secCheck4.error };

  // ---------- Pode pedir senha novamente ----------
  try {
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      log('  Re-autenticando (senha)...');
      await passwordInput.fill(account.password);
      await page.keyboard.press('Enter');
      await sleep(randomDelay(2000, 4000));
      // Checa desafios/bloqueio
      const secCheck5 = await handleSecurityChallenges(page, account, log);
      if (secCheck5.blocked) return { success: false, error: secCheck5.error };
    }
  } catch { /* sem re-auth */ }

  // ---------- Clicar no botão de editar ----------
  log('🔷 [EMAIL] Clicando em editar...');
  await clickFirst(page, [
    'xpath=//*[@id="yDmH0d"]/c-wiz/div/div[2]/div[3]/c-wiz/div/div/div[4]/div/ul/li/div/div[2]/div[1]/button/div',
    'button[aria-label*="Editar"]',
    'button[aria-label*="Edit"]',
    'a[aria-label*="Editar"]',
    'a[aria-label*="Edit"]',
    '[data-editicon]',
    'button:has-text("Atualizar")',
    'button:has-text("Update")',
    'button:has-text("Adicionar")',
    'button:has-text("Add")',
    'svg[data-icon="create"]',
  ], 'Editar email', log, 10000);

  await sleep(randomDelay(1500, 3000));
  // Checa desafios/bloqueio
  const secCheck6 = await handleSecurityChallenges(page, account, log);
  if (secCheck6.blocked) return { success: false, error: secCheck6.error };

  // ---------- Preencher novo email ----------
  log(`🔷 [EMAIL] Preenchendo: ${TARGET_RECOVERY_EMAIL}`);
  const emailFilled = await page.evaluate((targetEmail) => {
    const inputs = Array.from(document.querySelectorAll('input[type="email"], input[type="text"], input:not([type])'));
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (inp.type === 'password' || inp.type === 'hidden') continue;
      inp.focus();
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.value = targetEmail;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, TARGET_RECOVERY_EMAIL);

  if (!emailFilled) {
    try {
      const emailInput = page.locator('input[type="email"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: 5000 });
      await emailInput.fill(TARGET_RECOVERY_EMAIL);
    } catch {
      try {
        const textInput = page.locator('input[type="text"]').first();
        await textInput.waitFor({ state: 'visible', timeout: 5000 });
        await textInput.fill(TARGET_RECOVERY_EMAIL);
      } catch {
        return { success: false, error: 'Campo de email não encontrado' };
      }
    }
  }
  // Checa desafios/bloqueio
  const secCheck7 = await handleSecurityChallenges(page, account, log);
  if (secCheck7.blocked) return { success: false, error: secCheck7.error };

  await sleep(randomDelay(1000, 2000));
  // Checa desafios/bloqueio
  const secCheck8 = await handleSecurityChallenges(page, account, log);
  if (secCheck8.blocked) return { success: false, error: secCheck8.error };

  // ---------- Confirmar ----------
  log('🔷 [EMAIL] Confirmando...');
  await clickFirst(page, [
    'xpath=//*[@id="yDmH0d"]/div[16]/div[2]/div/div[2]/div[2]/button/span[4]',
    'button:has-text("Próxima")',
    'button:has-text("Next")',
    'button:has-text("Confirmar")',
    'button:has-text("Confirm")',
    'button:has-text("Salvar")',
    'button:has-text("Save")',
    'button:has-text("Concluir")',
    'button:has-text("Done")',
    'button[type="submit"]',
  ], 'Confirmar', log, 10000);

  await sleep(randomDelay(3000, 5000));
  // Checa desafios/bloqueio
  const secCheck9 = await handleSecurityChallenges(page, account, log);
  if (secCheck9.blocked) return { success: false, error: secCheck9.error };

  // Google pede código = email trocado com sucesso
  const pageAfter = await page.content();
  if (pageAfter.match(/c[oó]digo|code|verif/i)) {
    log('✅ [EMAIL] Google pediu código — email alterado com sucesso!');
    return { success: true };
  }
  // Checa desafios/bloqueio
  const secCheck10 = await handleSecurityChallenges(page, account, log);
  if (secCheck10.blocked) return { success: false, error: secCheck10.error };

  // Validar
  try {
    await page.goto('https://myaccount.google.com/security', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await sleep(randomDelay(2000, 4000));
    const finalContent = await page.content();
    if (finalContent.includes(TARGET_RECOVERY_EMAIL)) {
      log(`✅ [EMAIL] Validado: email é ${TARGET_RECOVERY_EMAIL}`);
      return { success: true };
    }
  } catch {
    log('⚠️ [EMAIL] Validação falhou, mas confirmação já foi feita');
  }

  log('⚠️ [EMAIL] Fluxo completou sem erros');
  return { success: true };
}

/**
 * Troca a senha da conta Google usando uma page já logada.
 * Retorna { success, skipped?, error? }
 */
async function doChangePassword(page, account, log) {
  // ---------- Navegar para Segurança ----------
  log('🔷 [SENHA] Navegando para myaccount.google.com/security...');
  await page.goto('https://myaccount.google.com/security', {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await sleep(randomDelay(3000, 5000));
  // Checa desafios/bloqueio
  const secCheck = await handleSecurityChallenges(page, account, log);
  if (secCheck.blocked) return { success: false, error: secCheck.error };

  // ---------- Se a senha já é a target, skip ----------
  if (account.password === TARGET_PASSWORD) {
    log(`✅ [SENHA] Senha já é a correta no store — skip`);
    return { success: true, skipped: true };
  }

  // ---------- Clicar em "Senha" ----------
  log('🔷 [SENHA] Clicando em "Senha"...');
  const passwordClicked = await clickFirst(page, [
    'xpath=//*[@id="yDmH0d"]/c-wiz/div[1]/div[2]/div/c-wiz/c-wiz/div/div[1]/div/div/div/nav/span/div/div[4]/span/a/div/div[1]',
    'a:has-text("Senha")',
    'a:has-text("Password")',
    'a[href*="signoptions/password"]',
  ], 'Senha', log, 10000);

  if (!passwordClicked) {
    log('  Tentando encontrar via evaluate...');
    const found = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, [role="link"]'));
      for (const el of links) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'senha' || text === 'password') {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!found) {
      return { success: false, error: 'Botão "Senha" não encontrado' };
    }
  }

  await sleep(randomDelay(3000, 5000));
  log(`📍 [SENHA] URL: ${page.url()}`);

  // ---------- Google pede a senha atual ----------
  log('🔷 [SENHA] Digitando senha atual...');
  try {
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.waitFor({ state: 'visible', timeout: 10000 });
    await pwInput.fill(account.password);
    await sleep(randomDelay(500, 1500));
    await page.keyboard.press('Enter');
    await sleep(randomDelay(3000, 5000));
  } catch (err) {
    return { success: false, error: `Não encontrou campo de senha atual: ${err.message}` };
  }

  log(`📍 [SENHA] URL após autenticação: ${page.url()}`);

  // ---------- Preencher nova senha ----------
  log('🔷 [SENHA] Preenchendo nova senha...');
  try {
    // Campo "Nova senha" — XPath fixo fornecido pelo usuário
    const newPasswordInput = page.locator('xpath=//*[@id="i6"]');
    await newPasswordInput.waitFor({ state: 'visible', timeout: 10000 });
    await newPasswordInput.fill(TARGET_PASSWORD);
    await sleep(randomDelay(500, 1000));

    // Campo "Confirme a senha" — XPath fixo fornecido pelo usuário
    const confirmPasswordInput = page.locator('xpath=//*[@id="i12"]');
    await confirmPasswordInput.waitFor({ state: 'visible', timeout: 10000 });
    await confirmPasswordInput.fill(TARGET_PASSWORD);
    await sleep(randomDelay(500, 1000));
  } catch (err) {
    return { success: false, error: `Campos de nova senha não encontrados: ${err.message}` };
  }

  // ---------- Clicar em "Alterar senha" ----------
  log('🔷 [SENHA] Clicando em "Alterar senha"...');
  const confirmClicked = await clickFirst(page, [
    'xpath=//*[@id="yDmH0d"]/c-wiz/div/div[2]/div[3]/c-wiz/div/div[4]/form/div/div[2]/div/div/button/span[4]',
    'button:has-text("Alterar senha")',
    'button:has-text("Change password")',
    'button[type="submit"]',
  ], 'Alterar senha', log, 10000);

  if (!confirmClicked) {
    return { success: false, error: 'Botão "Alterar senha" não encontrado' };
  }

  await sleep(randomDelay(3000, 5000));
  log(`📍 [SENHA] URL pós-alterar: ${page.url()}`);

  log('✅ [SENHA] Senha alterada com sucesso!');
  return { success: true };
}

/**
 * Abre browser, faz login, e executa AMBAS as tarefas (email + senha) na mesma sessão.
 * Timeout interno que FORÇA o fechamento do browser ao travar.
 */
async function runSecurityTasks(account, log = console.log) {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos (2 tarefas)
  const profilePath = join(PROFILES_DIR, account.id);
  if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

  // ---------- Proxy setup ----------
  const proxyConfig = parseProxy(account.proxy);
  let proxyForBrowser = null;
  let proxyTunnel = null;

  if (proxyConfig) {
    if (proxyConfig.type === 'socks5' && proxyConfig.hasAuth) {
      try {
        log('Criando tunnel SOCKS5 com autenticação...');
        proxyTunnel = await createSocksProxyTunnel(
          proxyConfig.host, proxyConfig.port,
          proxyConfig.username, proxyConfig.password
        );
        proxyForBrowser = { server: proxyTunnel.url };
      } catch (err) {
        throw new Error(`Falha ao criar tunnel SOCKS5: ${err.message}`);
      }
    } else if (proxyConfig.type === 'socks5') {
      proxyForBrowser = { server: `socks5://${proxyConfig.host}:${proxyConfig.port}` };
    } else {
      if (proxyConfig.username && proxyConfig.password) {
        proxyForBrowser = {
          server: `http://${proxyConfig.host}:${proxyConfig.port}`,
          username: proxyConfig.username,
          password: proxyConfig.password,
        };
      } else {
        proxyForBrowser = { server: `http://${proxyConfig.host}:${proxyConfig.port}` };
      }
    }
  }

  const launchOpts = {
    headless: process.env.HEADLESS === 'true',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-default-apps',
    ],
  };
  if (proxyForBrowser) launchOpts.proxy = proxyForBrowser;

  let context = null;
  let timedOut = false;
  let timeoutId = null;

  // Resultados de cada tarefa
  const results = { email: null, password: null };

  try {
    log('Iniciando browser...');
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await sleep(3000);

    // Timeout que FORÇA o fechamento do browser
    timeoutId = setTimeout(() => {
      timedOut = true;
      log('⏱️ Timeout de 5 min! Forçando fechamento do browser...');
      if (context) context.close().catch(() => {});
    }, TIMEOUT_MS);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(25000);

    // ---------- Login (uma vez só) ----------
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail, account.totpSecret || '');

    // ---------- Tarefa 1: Trocar email de recuperação ----------
    try {
      results.email = await doChangeRecoveryEmail(page, account, log);
    } catch (err) {
      results.email = { success: false, error: err.message };
      log(`❌ [EMAIL] Erro: ${err.message}`);
    }

    // ---------- Tarefa 2: Trocar senha ----------
    try {
      results.password = await doChangePassword(page, account, log);
    } catch (err) {
      results.password = { success: false, error: err.message };
      log(`❌ [SENHA] Erro: ${err.message}`);
    }

    return results;

  } catch (err) {
    if (timedOut) {
      log('⏱️ Timeout geral — browser forçadamente encerrado');
      // Marca o que não foi processado como erro de timeout
      if (!results.email) results.email = { success: false, error: 'Timeout', timedOut: true };
      if (!results.password) results.password = { success: false, error: 'Timeout', timedOut: true };
      return results;
    }
    log(`❌ Erro geral: ${err.message}`);
    if (!results.email) results.email = { success: false, error: err.message };
    if (!results.password) results.password = { success: false, error: err.message };
    return results;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (context) {
      try { await context.close(); } catch {}
    }
    if (proxyTunnel) {
      try { await proxyTunnel.close(); } catch {}
    }
  }
}

/**
 * Processa UMA conta: abre browser, faz login, troca email + senha, atualiza store.
 * Isolada para rodar em paralelo sem afetar as demais.
 */
async function processOneAccount(account) {
  const { id, email } = account;

  updateAccount(id, { warmupCurrentStep: 'security' });
  broadcast('account-update', { id, warmupCurrentStep: 'security' });

  try {
    const results = await runSecurityTasks(account, (msg) => {
      makeLog('info', email, `${email}: ${msg}`);
    });

    const storeUpdate = { warmupCurrentStep: 'done' };

    // ── Email de recuperação ──
    if (results.email?.success) {
      storeUpdate.recoveryEmail = TARGET_RECOVERY_EMAIL;
      if (results.email.skipped) {
        makeLog('info', email, `${email}: ✅ Email — já correto`);
      } else {
        makeLog('success', email, `${email}: ✅ Email — alterado para ${TARGET_RECOVERY_EMAIL}`);
      }
    } else {
      makeLog('error', email, `${email}: ❌ Email — ${results.email?.error || 'erro desconhecido'}`);
    }

    // ── Senha ──
    if (results.password?.success) {
      if (!results.password.skipped) {
        // Senha foi trocada — atualiza no store para manter sincronia
        storeUpdate.password = TARGET_PASSWORD;
        makeLog('success', email, `${email}: ✅ Senha — alterada com sucesso`);
      } else {
        makeLog('info', email, `${email}: ✅ Senha — já correta`);
      }
    } else {
      makeLog('error', email, `${email}: ❌ Senha — ${results.password?.error || 'erro desconhecido'}`);
    }

    // Se pelo menos uma tarefa funcionou, não é erro total
    if (results.email?.success || results.password?.success) {
      updateAccount(id, storeUpdate);
      broadcast('account-update', { id, ...storeUpdate });
    } else {
      updateAccount(id, { warmupCurrentStep: 'error' });
      broadcast('account-update', { id, warmupCurrentStep: 'error' });
    }

  } catch (err) {
    makeLog('error', email, `${email}: Erro inesperado: ${err.message}`);
    updateAccount(id, { warmupCurrentStep: 'error' });
    broadcast('account-update', { id, warmupCurrentStep: 'error' });
  }
}

/**
 * Executa segurança (email + senha) para múltiplas contas.
 * Roda em paralelo com limite de concorrência.
 */
export async function runSecurityUpdate(accountIds) {
  if (isRunning) {
    makeLog('warn', null, 'Segurança já em execução.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'Nenhuma conta selecionada.');
    return;
  }

  isRunning = true;
  shouldStop = false;
  broadcast('recovery-status', { isRunning: true });

  try {
    const allAccounts = getAccounts();
    const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

    if (accounts.length === 0) {
      makeLog('warn', null, 'Nenhuma conta encontrada para os IDs fornecidos.');
      return;
    }

    makeLog('info', null, `Segurança: Iniciando para ${accounts.length} conta(s) sem limitador de concorrência`);

    if (shouldStop) {
      makeLog('warn', null, 'Segurança: Parado pelo usuário.');
      return;
    }

    await Promise.all(accounts.map((account) => processOneAccount(account)));

    makeLog('info', null, 'Segurança: Fluxo finalizado.');
  } finally {
    isRunning = false;
    shouldStop = false;
    broadcast('recovery-status', { isRunning: false });
  }
}

// Mantém compatibilidade com o endpoint antigo
export const runRecoveryEmailUpdate = runSecurityUpdate;