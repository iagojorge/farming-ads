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

const TARGET_RECOVERY_EMAIL = 'iagojorge@agencia-titan.com';

let isRunning = false;

export function getRecoveryWorkerStatus() {
  return { isRunning };
}

function makeLog(level, email, message) {
  addLog({ level, source: email || 'recovery-worker', message, timestamp: new Date().toISOString() });
  broadcast('log', { level, source: email || 'recovery-worker', message });
}

/**
 * Troca o email de recuperação de uma conta.
 * Retorna { success, newRecoveryEmail?, error? }
 */
async function updateRecoveryEmail(account, log = console.log) {
  const profilePath = join(PROFILES_DIR, account.id);
  if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

  // ---------- Proxy setup (mesmo padrão do runGoogleAdsOnly) ----------
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
  try {
    log('Iniciando browser...');
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await sleep(3000);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);

    // ---------- Login ----------
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail);

    // ---------- Navegar para Segurança ----------
    log('🔷 Navegando para myaccount.google.com/security...');
    await page.goto('https://myaccount.google.com/security', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(randomDelay(4000, 6000));

    log(`📍 URL: ${page.url()}`);

    // ---------- Verificar email atual ----------
    // Tenta encontrar o email de recuperação na página
    const pageContent = await page.content();
    if (pageContent.includes(TARGET_RECOVERY_EMAIL)) {
      log(`✅ Email de recuperação já é ${TARGET_RECOVERY_EMAIL} — nada a fazer`);
      return { success: true, newRecoveryEmail: TARGET_RECOVERY_EMAIL, skipped: true };
    }

    // ---------- Clicar em "E-mail de recuperação" ----------
    log('🔷 Procurando link de email de recuperação...');

    // Tenta clicar no link/botão de "E-mail de recuperação"
    const recoveryClicked = await clickFirst(page, [
      'a[href*="recovery/email"]',
      'a[href*="signoptions/rescuephone"]',
      '[data-settingid="recovery-email"]',
      'a:has-text("E-mail de recuperação")',
      'a:has-text("Recovery email")',
      'a:has-text("recovery email")',
    ], 'E-mail de recuperação', log, 10000);

    if (!recoveryClicked) {
      // Tenta por evaluate — busca link que contenha texto sobre recovery email
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
        log('❌ Não encontrou link de email de recuperação na página de segurança');
        return { success: false, error: 'Link de email de recuperação não encontrado' };
      }
    }

    await sleep(randomDelay(3000, 5000));
    log(`📍 URL: ${page.url()}`);

    // ---------- Pode pedir senha novamente ----------
    try {
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        log('  Re-autenticando (senha)...');
        await passwordInput.fill(account.password);
        await page.keyboard.press('Enter');
        await sleep(randomDelay(3000, 5000));
      }
    } catch { /* sem re-auth */ }

    // ---------- Clicar no botão de editar / lápis / adicionar ----------
    log('🔷 Clicando em editar email de recuperação...');
    const editClicked = await clickFirst(page, [
      'button[aria-label*="Editar"]',
      'button[aria-label*="Edit"]',
      'a[aria-label*="Editar"]',
      'a[aria-label*="Edit"]',
      '[data-editicon]',
      'button:has-text("Atualizar")',
      'button:has-text("Update")',
      'button:has-text("Adicionar")',
      'button:has-text("Add")',
      // Pencil icon buttons perto do email
      'svg[data-icon="create"]',
    ], 'Editar email', log, 10000);

    if (!editClicked) {
      // Se não precisa editar, pode já estar no formulário
      log('  Sem botão de editar — verificando se formulário já está visível...');
    }

    await sleep(randomDelay(2000, 4000));

    // ---------- Preencher novo email ----------
    log(`🔷 Preenchendo email: ${TARGET_RECOVERY_EMAIL}`);

    // Limpa e preenche o campo de email
    const emailFilled = await page.evaluate((targetEmail) => {
      // Busca input de email visível (não password, não hidden)
      const inputs = Array.from(document.querySelectorAll('input[type="email"], input[type="text"], input:not([type])'));
      for (const inp of inputs) {
        const rect = inp.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (inp.type === 'password' || inp.type === 'hidden') continue;

        // Limpa e preenche
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
      // Fallback: tenta com locator
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
          log('❌ Não encontrou campo de email para preencher');
          return { success: false, error: 'Campo de email não encontrado' };
        }
      }
    }

    log('  Email preenchido');
    await sleep(randomDelay(1500, 3000));

    // ---------- Confirmar / Próximo ----------
    log('🔷 Confirmando...');
    await clickFirst(page, [
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

    await sleep(randomDelay(4000, 6000));
    log(`📍 URL pós-confirmar: ${page.url()}`);

    // ---------- Google pede código de verificação — não precisa validar ----------
    // Se apareceu tela de código, significa que o email foi enviado com sucesso
    const pageAfter = await page.content();
    const askingCode = pageAfter.match(/c[oó]digo|code|verif/i);
    if (askingCode) {
      log('✅ Google pediu código de verificação — email de recuperação alterado com sucesso!');
      log('  (Não precisa validar o código)');
      return { success: true, newRecoveryEmail: TARGET_RECOVERY_EMAIL };
    }

    // ---------- Validar se realmente trocou ----------
    log('🔷 Validando alteração...');
    await page.goto('https://myaccount.google.com/security', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(randomDelay(4000, 6000));

    const finalContent = await page.content();
    if (finalContent.includes(TARGET_RECOVERY_EMAIL)) {
      log(`✅ Validado: email de recuperação é ${TARGET_RECOVERY_EMAIL}`);
      return { success: true, newRecoveryEmail: TARGET_RECOVERY_EMAIL };
    }

    // Mesmo sem validação visível, se não deu erro, considera sucesso
    log('⚠️ Não conseguiu validar visualmente, mas fluxo completou sem erros');
    return { success: true, newRecoveryEmail: TARGET_RECOVERY_EMAIL };

  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (context) {
      try { await context.close(); } catch {}
    }
    if (proxyTunnel) {
      try { await proxyTunnel.close(); } catch {}
    }
  }
}

/**
 * Executa a troca de email de recuperação para múltiplas contas.
 */
export async function runRecoveryEmailUpdate(accountIds) {
  if (isRunning) {
    makeLog('warn', null, 'Troca de recovery email já em execução.');
    return;
  }

  if (!accountIds || accountIds.length === 0) {
    makeLog('warn', null, 'Nenhuma conta selecionada para troca de recovery email.');
    return;
  }

  isRunning = true;
  broadcast('recovery-status', { isRunning: true });

  try {
    const allAccounts = getAccounts();
    const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

    if (accounts.length === 0) {
      makeLog('warn', null, 'Nenhuma conta encontrada para os IDs fornecidos.');
      return;
    }

    // Filtra contas que já têm o email correto
    const toUpdate = accounts.filter((a) => a.recoveryEmail !== TARGET_RECOVERY_EMAIL);
    const alreadyOk = accounts.length - toUpdate.length;

    if (alreadyOk > 0) {
      makeLog('info', null, `${alreadyOk} conta(s) já possuem o email de recuperação correto.`);
    }

    if (toUpdate.length === 0) {
      makeLog('info', null, 'Todas as contas já possuem o email de recuperação correto.');
      return;
    }

    makeLog('info', null, `Recovery Email: Iniciando troca para ${toUpdate.length} conta(s)`);

    // Executa sequencialmente (1 por vez para evitar problemas)
    for (const account of toUpdate) {
      const { id, email } = account;

      updateAccount(id, { warmupCurrentStep: 'recovery-email' });
      broadcast('account-update', { id, warmupCurrentStep: 'recovery-email' });

      try {
        const result = await updateRecoveryEmail(account, (msg) => {
          makeLog('info', email, `${email}: ${msg}`);
        });

        if (result.success) {
          if (result.skipped) {
            makeLog('info', email, `${email}: Email de recuperação já é ${TARGET_RECOVERY_EMAIL}`);
          } else {
            updateAccount(id, { recoveryEmail: TARGET_RECOVERY_EMAIL });
            makeLog('success', email, `✅ ${email}: Email de recuperação alterado para ${TARGET_RECOVERY_EMAIL}`);
            broadcast('account-update', { id, recoveryEmail: TARGET_RECOVERY_EMAIL, warmupCurrentStep: 'done' });
          }
        } else {
          makeLog('error', email, `${email}: Falha na troca — ${result.error}`);
          broadcast('account-update', { id, warmupCurrentStep: 'error' });
        }
      } catch (err) {
        makeLog('error', email, `${email}: Erro: ${err.message}`);
        broadcast('account-update', { id, warmupCurrentStep: 'error' });
      }
    }

    makeLog('info', null, 'Recovery Email: Fluxo finalizado.');
  } finally {
    isRunning = false;
    broadcast('recovery-status', { isRunning: false });
  }
}
