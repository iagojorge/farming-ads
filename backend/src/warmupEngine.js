/**
 * Motor de aquecimento de contas Google usando Playwright.
 *
 * Fluxo completo:
 * 1. Abre browser persistente com proxy
 * 2. Login no Google
 * 3. Abre YouTube → pesquisa → assiste vídeo
 * 4. Abre globo.com → navega por notícias
 * 5. Abre Gmail → abre email aleatório
 * 6. Finaliza sessão
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { TIMINGS, YOUTUBE_SEARCH_TERMS, randomDelay, randomItem } from './warmupTimings.js';
import { createSocksProxyTunnel } from './socksProxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, '../../data/profiles');

// Garante diretório de perfis
if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function humanDelay() {
  await sleep(randomDelay());
}

async function safeType(page, selector, text) {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  await el.click({ clickCount: 3 });
  await el.type(text, { delay: TIMINGS.typingDelay });
}

async function safeClick(page, selector, opts = {}) {
  const el = await page.waitForSelector(selector, { timeout: opts.timeout || 15000 });
  await humanDelay();
  await el.click();
}

async function goToWithRetry(page, url, log, maxRetries = 3, timeout = 45000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`[Tentativa ${attempt}/${maxRetries}] Acessando ${url.split('?')[0]}`);
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: timeout,
      });
      log(`✓ Página carregou`);
      return true;
    } catch (err) {
      log(`✗ Erro: ${err.message}`);
      if (attempt < maxRetries) {
        const delayMs = Math.min(5000 * attempt, 15000);
        log(`Aguardando ${delayMs / 1000}s antes de tentar novamente...`);
        await sleep(delayMs);
      }
    }
  }
  throw new Error(`Não conseguiu acessar ${url} após ${maxRetries} tentativas`);
}

function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  
  // Se começar com socks5:// ou http://, remova o prefixo
  let cleanStr = proxyStr;
  let type = null;
  
  if (proxyStr.startsWith('socks5://')) {
    type = 'socks5';
    cleanStr = proxyStr.substring(9); // remove "socks5://"
  } else if (proxyStr.startsWith('http://')) {
    type = 'http';
    cleanStr = proxyStr.substring(7); // remove "http://"
  }
  
  const parts = cleanStr.split(':');
  if (parts.length < 2) return null;
  
  const host = parts[0];
  const port = parseInt(parts[1]);
  const username = parts[2] || null;
  const password = parts[3] || null;
  
  // Se tipo não foi especificado, assume SOCKS5
  if (!type) {
    type = 'socks5';
  }
  
  return {
    type,
    host,
    port,
    username,
    password,
    hasAuth: username && password,
  };
}

// ── Etapa 1: Login Google ─────────────────────────────────────

/**
 * Função auxiliar: clica em botões por texto na página.
 * Retorna string descrevendo o que clicou, ou null se não achou nada.
 */
async function clickButtonByText(page, patterns) {
  return page.evaluate((pats) => {
    const allButtons = Array.from(document.querySelectorAll(
      'button, a[role="button"], div[role="button"], span[role="button"], ' +
      'li, div[data-challengetype], [jsaction*="click"]'
    ));
    for (const patStr of pats) {
      const pattern = new RegExp(patStr, 'i');
      const btn = allButtons.find(b => {
        const text = (b.textContent || b.innerText || '').trim();
        return pattern.test(text);
      });
      if (btn) {
        console.log(`[CLICK] Clicou: ${btn.textContent.trim()}`);
        btn.click();
        return (btn.textContent || '').trim().substring(0, 50);
      }
    }
    return null;
  }, patterns.map(p => p.source));
}

/**
 * Verifica se a URL indica que login já foi concluído.
 */
function isLoggedInUrl(url) {
  if (url.includes('myaccount.google.com')) return true;
  if (url.includes('mail.google.com')) return true;
  if (url.includes('youtube.com')) return true;
  if (url.includes('accounts.google.com') &&
      !url.includes('signin') &&
      !url.includes('challenge') &&
      !url.includes('speedbump') &&
      !url.includes('interstitial') &&
      !url.includes('accountchooser')) return true;
  return false;
}

async function loginGoogle(page, email, password, log, recoveryEmail = '') {
  log('Navegando para accounts.google.com');
  await goToWithRetry(page, 'https://accounts.google.com/signin/v2/identifier?hl=pt-BR', log, 3);

  // Checa se já está logado
  if (isLoggedInUrl(page.url())) {
    log('Já logado no Google! Pulando login.');
    return true;
  }

  // ── PASSO 1: Garantir que estamos na tela de email ──
  // Se tem account chooser → clica "Usar outra conta" ou seleciona a conta
  log('Aguardando tela de login carregar...');
  const firstElement = await Promise.race([
    page.waitForSelector('input[type="email"]', { visible: true, timeout: 20000 }).then(el => ({ type: 'email-input', el })),
    page.waitForSelector('input[type="password"]', { visible: true, timeout: 20000 }).then(el => ({ type: 'password-input', el })),
    page.waitForSelector('[data-email], [data-identifier]', { timeout: 20000 }).then(el => ({ type: 'account-chooser', el })),
  ]).catch(() => null);

  if (!firstElement) {
    log('⚠ Nenhum elemento reconhecido na tela — tentando Enter...');
    await page.keyboard.press('Enter');
    await sleep(3000);
  } else if (firstElement.type === 'account-chooser') {
    log('Tela "Escolha uma conta" detectada');
    // Tenta clicar "Usar outra conta" para ter um campo de email limpo
    const clicked = await page.evaluate((targetEmail) => {
      const items = Array.from(document.querySelectorAll('[data-email], [data-identifier]'));
      for (const item of items) {
        const de = item.getAttribute('data-email') || item.getAttribute('data-identifier') || '';
        if (de === targetEmail) { item.click(); return 'found'; }
      }
      // Não achou → clica "Usar outra conta"
      const all = Array.from(document.querySelectorAll('li, div[role="link"], button'));
      const btn = all.find(l => /outra conta|another account|다른 계정|使用其他帐号|別のアカウント/i.test(l.textContent || ''));
      if (btn) { btn.click(); return 'another'; }
      // Clica no primeiro item
      if (items[0]) { items[0].click(); return 'first'; }
      return null;
    }, email);

    log(`  Ação: ${clicked}`);
    await sleep(3000);

    if (clicked === 'another') {
      // Agora deve aparecer o campo de email
      try {
        const emailInput = await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });
        log('Digitando email');
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email, { delay: TIMINGS.typingDelay });
        await page.keyboard.press('Enter');
        await sleep(TIMINGS.pageLoadWait);
      } catch {
        log('⚠ Campo de email não apareceu após "Usar outra conta"');
      }
    }
    // Se clicou na conta certa ou na primeira, vai direto pro password
  } else if (firstElement.type === 'email-input') {
    log('Digitando email');
    await firstElement.el.click({ clickCount: 3 });
    await firstElement.el.type(email, { delay: TIMINGS.typingDelay });
    await sleep(300);
    await page.keyboard.press('Enter');
    log('  ✓ Email enviado (Enter)');
    await sleep(TIMINGS.pageLoadWait);
  } else if (firstElement.type === 'password-input') {
    log('Campo de senha já visível — email já preenchido anteriormente');
    // Vai direto pro passo de senha
  }

  // ── PASSO 2: Digitar senha ──
  try {
    const passwordInput = await page.waitForSelector('input[type="password"]', {
      visible: true,
      timeout: 15000,
    });
    log('Digitando senha');
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(password, { delay: TIMINGS.typingDelay });
    await sleep(500);
    await page.keyboard.press('Enter');
    log('  ✓ Senha enviada');
    await sleep(TIMINGS.loginWaitAfter);
  } catch {
    log('Campo de senha não apareceu — pode já estar logado ou em outra tela');
  }

  // ── PASSO 3: Loop para tratar telas de segurança pós-login ──
  const MAX_SECURITY_ROUNDS = 15;
  let recoveryEmailUsed = false;

  const SKIP_PATTERNS = [
    /^agora não$/i, /^not now$/i, /^skip$/i, /^pular$/i,
    /^不用了$/i, /^현재 안함$/i, /^나중에$/i, /^今は不要$/i, /^以后再说$/i,
    /^não,?\s*obrigado/i, /^no,?\s*thanks/i,
    /^mais tarde$/i, /^later$/i, /^talvez depois$/i, /^maybe later$/i,
    /^dismiss$/i, /^dispensar$/i, /^fechar$/i, /^close$/i,
    /^cancelar$/i, /^cancel$/i, /^취소$/i, /^キャンセル$/i, /^取消$/i,
    /^não$/i, /^done$/i, /^concluído$/i, /^pronto$/i,
    /^lembrar mais tarde$/i, /^remind me later$/i,
    /^não ativar$/i, /^não, obrigado$/i,
    /^건너뛰기$/i, /^跳过$/i, /^スキップ$/i,
  ];

  const ADVANCE_PATTERNS = [
    /^confirmar$/i, /^confirm$/i, /^확인$/i, /^確認$/i, /^确认$/i,
    /^avançar$/i, /^próximo$/i, /^next$/i, /^다음$/i, /^次へ$/i, /^下一步$/i,
    /^continuar$/i, /^continue$/i, /^계속$/i, /^続行$/i, /^继续$/i,
    /^sim$/i, /^yes$/i, /^네$/i, /^はい$/i, /^是$/i,
    /^aceitar$/i, /^accept$/i, /^i agree$/i, /^concordo$/i, /^동의$/i, /^同意$/i,
    /^entendi$/i, /^got it$/i, /^ok$/i, /^알겠습니다$/i, /^了解$/i,
    /^ativar$/i, /^turn on$/i,
  ];

  for (let round = 1; round <= MAX_SECURITY_ROUNDS; round++) {
    await sleep(2000);
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const bodySnippet = bodyText.substring(0, 600).replace(/\n+/g, ' | ');
    log(`[Segurança round ${round}] URL: ${currentUrl}`);
    log(`  📄 Texto: ${bodySnippet}`);

    // Login OK?
    if (isLoggedInUrl(currentUrl)) {
      log('✓ Login no Google concluído!');
      return true;
    }

    // Senha incorreta
    if (/senha incorreta|wrong password|incorreta|잘못된.*비밀번호|密码错误|パスワードが違います/i.test(bodyText)) {
      throw new Error('Senha incorreta');
    }

    // ── "Confirme que é você" / 2FA → usar email de recuperação ──
    const isChallengePage = currentUrl.includes('challenge') ||
      /confirme que é você|confirm it.?s you|본인 확인|verify.*identity|身份验证/i.test(bodyText);

    if (isChallengePage && recoveryEmail && !recoveryEmailUsed) {
      log('  🔐 Tela de verificação detectada — fluxo de email de recuperação...');

      // DEBUG: lista todos os elementos clicáveis na página
      const pageElements = await page.evaluate(() => {
        const clickable = Array.from(document.querySelectorAll(
          'button, a, li, div[role="button"], div[role="link"], div[data-challengetype], ' +
          'div[jsname], div[tabindex], span[role="button"]'
        ));
        return clickable.slice(0, 30).map(el => ({
          tag: el.tagName,
          text: (el.textContent || '').trim().substring(0, 100),
          role: el.getAttribute('role'),
          ct: el.getAttribute('data-challengetype'),
        }));
      });
      log(`  🔍 Elementos: ${JSON.stringify(pageElements.slice(0, 15))}`);

      // ESTRATÉGIA 1: data-challengetype="12" (recovery email no Google)
      let foundRecoveryOption = await page.evaluate(() => {
        const byType = document.querySelector('[data-challengetype="12"]');
        if (byType) { byType.click(); return 'challengetype-12'; }
        return false;
      });

      // ESTRATÉGIA 2: Texto que mencione "recuperação" / "recovery"
      if (!foundRecoveryOption) {
        foundRecoveryOption = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll(
            'li, div[role="link"], div[role="button"], div[data-challengetype], ' +
            'button, a, div[jsname], div[tabindex], span'
          ));
          const opt = allEls.find(el => {
            const t = (el.textContent || el.innerText || '').toLowerCase();
            return /e-?mail.*recupera|recovery.*e-?mail|복구.*이메일|恢复.*邮件|recuperação|recovery/i.test(t) &&
                   t.length < 200;
          });
          if (opt) { opt.click(); return 'text-recovery'; }
          return false;
        });
      }

      // ESTRATÉGIA 3: email obfuscado (ex: b***@teml.net) → clica nele
      if (!foundRecoveryOption && recoveryEmail) {
        const emailDomain = recoveryEmail.split('@')[1] || '';
        foundRecoveryOption = await page.evaluate((domain) => {
          const allEls = Array.from(document.querySelectorAll(
            'li, div[role="link"], div[role="button"], div[data-challengetype], ' +
            'button, a, div[jsname], div[tabindex]'
          ));
          const opt = allEls.find(el => {
            const t = (el.textContent || el.innerText || '').toLowerCase();
            return t.includes(domain.toLowerCase()) && t.length < 200;
          });
          if (opt) { opt.click(); return 'domain-match'; }
          return false;
        }, emailDomain);
      }

      // ESTRATÉGIA 4: "Tentar de outra forma" / "Try another way"
      if (!foundRecoveryOption) {
        const triedAnother = await clickButtonByText(page, [
          /tentar de outra forma/i, /tentar outra forma/i, /try another way/i,
          /다른 방법/i, /别的方式/i, /別の方法/i, /more options/i, /mais opções/i,
        ]);
        if (triedAnother) {
          log(`  ✓ Clicou "${triedAnother}" — buscando opção de email...`);
          await sleep(4000);

          const afterTryAnother = await page.evaluate((domain) => {
            const byType = document.querySelector('[data-challengetype="12"]');
            if (byType) { byType.click(); return 'challengetype-12'; }
            const allEls = Array.from(document.querySelectorAll(
              'li, div[role="link"], div[role="button"], div[data-challengetype], ' +
              'button, a, div[jsname], div[tabindex], span'
            ));
            const opt = allEls.find(el => {
              const t = (el.textContent || el.innerText || '').toLowerCase();
              return (/e-?mail.*recupera|recovery.*e-?mail|복구.*이메일|恢复.*邮件|recuperação|recovery/i.test(t) ||
                      (domain && t.includes(domain.toLowerCase()))) &&
                     t.length < 200;
            });
            if (opt) { opt.click(); return 'text-after-try'; }
            return false;
          }, recoveryEmail.split('@')[1] || '');

          if (afterTryAnother) {
            foundRecoveryOption = afterTryAnother;
          }
        }
      }

      if (foundRecoveryOption) {
        log(`  ✓ Selecionou opção: ${foundRecoveryOption}`);
        await sleep(4000);
      } else {
        log('  ⚠ Não encontrou opção de email de recuperação');
      }

      // Digita o email de recuperação
      try {
        const recInput = await page.waitForSelector('input[type="email"], input[type="text"]', {
          visible: true,
          timeout: 10000,
        });
        log(`  Digitando email de recuperação: ${recoveryEmail}`);
        await recInput.click({ clickCount: 3 });
        await sleep(300);
        await recInput.type(recoveryEmail, { delay: TIMINGS.typingDelay });
        await sleep(500);
        await page.keyboard.press('Enter');
        recoveryEmailUsed = true;
        log('  ✓ Email de recuperação enviado!');
        await sleep(5000);
        continue;
      } catch {
        log('  ⚠ Campo de email não apareceu — tentando input genérico...');
        const anyInput = await page.evaluate((recEmail) => {
          const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
          const visible = inputs.find(i => i.offsetParent !== null && i.type !== 'password');
          if (visible) {
            visible.focus();
            visible.value = '';
            visible.dispatchEvent(new Event('input', { bubbles: true }));
            for (const ch of recEmail) {
              visible.value += ch;
              visible.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return true;
          }
          return false;
        }, recoveryEmail);
        if (anyInput) {
          log('  ✓ Digitou no input genérico');
          await page.keyboard.press('Enter');
          recoveryEmailUsed = true;
          await sleep(5000);
          continue;
        }
      }
    }

    // ── "Não perca o acesso à conta" → Cancelar ──
    if (/não perca o acesso|don.?t lose access|액세스 권한을 잃지|失去访问权限|アクセスを失わない|proteger.*conta|protect.*account/i.test(bodyText)) {
      log('  Tela "Não perca o acesso" — clicando Cancelar...');
      const cancelled = await clickButtonByText(page, [
        /^cancelar$/i, /^cancel$/i, /^취소$/i, /^キャンセル$/i, /^取消$/i,
      ]);
      if (cancelled) {
        log(`  ✓ Cancelou: "${cancelled}"`);
        await sleep(3000);
        continue;
      }
    }

    // ── "Definir endereço de casa" → Pular ──
    if (/definir.*endereço|endereço de casa|set.*home.*address|set.*address|집 주소|住所を設定|设置.*地址/i.test(bodyText)) {
      log('  Tela "Definir endereço" — pulando...');
      const skippedAddr = await clickButtonByText(page, [
        /^pular$/i, /^skip$/i, /^건너뛰기$/i, /^跳过$/i, /^スキップ$/i,
        /^agora não$/i, /^not now$/i, /^현재 안함$/i,
        /^cancelar$/i, /^cancel$/i,
      ]);
      if (skippedAddr) {
        log(`  ✓ Pulou: "${skippedAddr}"`);
        await sleep(3000);
        continue;
      }
    }

    // ── "Adicionar telefone" → Pular ──
    if (/adicionar.*telefone|add.*phone|número.*telefone|phone number|전화번호|添加.*电话|電話番号/i.test(bodyText)) {
      log('  Tela "Adicionar telefone" — pulando...');
      const skippedPhone = await clickButtonByText(page, SKIP_PATTERNS);
      if (skippedPhone) {
        log(`  ✓ Pulou telefone: "${skippedPhone}"`);
        await sleep(3000);
        continue;
      }
    }

    // ── "Adicionar email de recuperação" (pós-login) → Pular ──
    if (/adicionar.*e-?mail.*recuperação|add.*recovery.*email|복구.*이메일.*추가|添加辅助邮箱/i.test(bodyText)) {
      log('  Tela "Adicionar email de recuperação" — pulando...');
      const skippedRec = await clickButtonByText(page, SKIP_PATTERNS);
      if (skippedRec) {
        log(`  ✓ Pulou: "${skippedRec}"`);
        await sleep(3000);
        continue;
      }
    }

    // ── 2FA real sem recovery email — aborta ──
    if (/challenge\/selection|challenge\/ipp|challenge\/sk|challenge\/az/i.test(currentUrl)) {
      if (!recoveryEmail || recoveryEmailUsed) {
        const tried = await clickButtonByText(page, [
          /tentar de outra forma/i, /try another way/i, /다른 방법/i, /别的方式/i,
        ]);
        if (tried) {
          log(`  ✓ Clicou: ${tried}`);
          await sleep(2000);
          continue;
        }
        if (!recoveryEmail) {
          throw new Error('2FA necessário e sem email de recuperação — resolver manualmente');
        }
      }
    }

    // Tenta SKIP genérico
    const skipped = await clickButtonByText(page, SKIP_PATTERNS);
    if (skipped) {
      log(`  ✓ Skip: "${skipped}"`);
      await sleep(3000);
      continue;
    }

    // Tenta AVANÇAR (só se não pede código)
    const needsCode = /código de verificação|verification code|autenticador|authenticator|chave de segurança|security key|insira.*código|인증.*코드|验证码|確認コード/i.test(bodyText);
    if (!needsCode) {
      const advanced = await clickButtonByText(page, ADVANCE_PATTERNS);
      if (advanced) {
        log(`  ✓ Avançou: "${advanced}"`);
        await sleep(3000);
        continue;
      }
    }

    // ESC
    await page.keyboard.press('Escape');
    await sleep(1500);
    if (page.url() !== currentUrl) { log('  ✓ ESC funcionou'); continue; }

    // Speedbump/passkey → myaccount
    if (/speedbump|passkey|interstitial|signinchooser/i.test(currentUrl)) {
      log('  ⚠ Tela de segurança, indo para myaccount...');
      try {
        await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle', timeout: 15000 });
        await sleep(2000);
        if (page.url().includes('myaccount.google.com')) {
          log('  ✓ Login confirmado via myaccount');
          return true;
        }
      } catch { /* ignora */ }
    }

    log('  ⚠ Nenhuma ação encontrada nesta rodada');

    // Últimas rodadas: força navegação
    if (round >= MAX_SECURITY_ROUNDS - 2) {
      log('  Forçando navegação para YouTube...');
      try {
        await page.goto('https://www.youtube.com', { waitUntil: 'networkidle', timeout: 20000 });
        await sleep(2000);
        return true;
      } catch { /* ignora */ }
    }
  }

  log('⚠ Passou por todas as telas de segurança, continuando');
  return true;
}

// ── Criar Canal YouTube (Dia 1) ───────────────────────────────

async function createYouTubeChannel(page, log) {
  log('📺 Criando canal no YouTube (dia 1)...');
  try {
    await goToWithRetry(page, 'https://www.youtube.com', log, 3);
    await sleep(TIMINGS.pageLoadWait);

    // Clica no ícone de perfil
    await goToWithRetry(page, 'https://studio.youtube.com', log, 3);
    await sleep(4000);

    // Se redirecionou para criação de canal
    const url = page.url();
    if (url.includes('create_channel') || url.includes('studio.youtube.com')) {
      log('✓ Canal já existe ou redirecionou para criação');

      // Tenta preencher nome do canal se pediu
      try {
        const nameInput = await page.waitForSelector('input[aria-label*="name"], input[placeholder*="name"], input[name="displayName"]', { timeout: 5000 });
        if (nameInput) {
          await nameInput.click({ clickCount: 3 });
          const channelName = 'Meu Canal ' + Math.floor(Math.random() * 9999);
          await nameInput.type(channelName, { delay: TIMINGS.typingDelay });
          log(`Nomeando canal: ${channelName}`);
          await sleep(1000);

          // Clica em criar/confirmar (abre modal)
          const created = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, yt-button-renderer'));
            const btn = btns.find(b => /criar|create|confirmar|confirm/i.test(b.textContent || ''));
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (created) {
            log('Modal de criação aberta, confirmando...');
            await sleep(randomDelay(2000, 3000));

            // Clica no botão "Criar canal" dentro da modal
            const confirmed = await page.evaluate(() => {
              // Procura botões dentro de dialogs/modals
              const selectors = [
                'dialog button',
                '[role="dialog"] button',
                'ytcp-dialog button',
                'tp-yt-paper-dialog button',
                '#dialog button',
                '.modal button',
                'yt-confirm-dialog-renderer button'
              ];
              for (const sel of selectors) {
                const btns = Array.from(document.querySelectorAll(sel));
                const btn = btns.find(b => /criar canal|create channel|criar|create/i.test(b.textContent || ''));
                if (btn) { btn.click(); return true; }
              }
              // Fallback: qualquer botão com texto "criar" que ainda não foi clicado
              const allBtns = Array.from(document.querySelectorAll('button, yt-button-renderer'));
              const btn = allBtns.find(b => /criar canal|create channel/i.test(b.textContent || ''));
              if (btn) { btn.click(); return true; }
              return false;
            });
            if (confirmed) {
              log('✓ Canal criado (confirmado na modal)!');
            } else {
              log('⚠ Não encontrou botão de confirmação na modal');
            }
            await sleep(3000);
          }
        }
      } catch {
        log('Canal já existia, continuando...');
      }
    }

    log('✓ Etapa de criação de canal concluída');
  } catch (err) {
    log(`⚠ Criar canal: ${err.message} — continuando sem criar`);
  }
}

// ── Se inscrever no canal do vídeo ───────────────────────────

async function subscribeToChannel(page, log) {
  log('👍 Tentando se inscrever no canal...');
  try {
    await sleep(2000);
    const subscribed = await page.evaluate(() => {
      // Tenta encontrar o botão de inscrever
      const allBtns = Array.from(document.querySelectorAll(
        'button, yt-button-renderer, ytd-subscribe-button-renderer button'
      ));
      const subBtn = allBtns.find(b => {
        const text = (b.textContent || b.innerText || '').trim();
        return /^inscrever-se$|^subscribe$|^inscrever$/i.test(text);
      });
      if (subBtn) {
        subBtn.click();
        return true;
      }
      return false;
    });

    if (subscribed) {
      log('✓ Inscrito no canal!');
      await sleep(2000);
    } else {
      log('Já inscrito ou botão não encontrado');
    }
  } catch (err) {
    log(`⚠ Inscrição: ${err.message}`);
  }
}

// ── Etapa 2: YouTube ──────────────────────────────────────────

async function browseYouTube(page, log) {
  const searchTerm = randomItem(YOUTUBE_SEARCH_TERMS);

  log(`Abrindo YouTube e pesquisando: "${searchTerm}"`);
  await goToWithRetry(page, 'https://www.youtube.com', log, 3);
  await sleep(TIMINGS.pageLoadWait);

  // Verifica e aceita termos/cookies se necessário
  try {
    log('Procurando por termos para aceitar...');
    // Tenta encontrar botão de "Aceitar" usando JavaScript
    const accepted = await page.evaluate(() => {
      // Procura em todos os botões por texto
      const buttons = Array.from(document.querySelectorAll('button, yt-button-renderer'));
      const acceptBtn = buttons.find(btn => {
        const text = btn.textContent || btn.innerText || '';
        return /aceitar|accept/i.test(text);
      });
      
      if (acceptBtn) {
        acceptBtn.click();
        return true;
      }
      return false;
    });
    
    if (accepted) {
      log('✓ Termos aceitos');
      await sleep(2000);
    } else {
      log('Nenhum termo encontrado, continuando...');
    }
  } catch (err) {
    log(`Não conseguiu aceitar termos (pode não ter): ${err.message}`);
  }

  // Verifica se está realmente logado no YouTube
  try {
    log('Verificando status de login no YouTube...');
    const isLoggedIn = await page.evaluate(() => {
      // Procura pela foto de perfil ou nome de usuário que aparece quando logado
      const profileButton = document.querySelector('yt-button-renderer[aria-label*="Criar"] button, button[aria-label*="Conta"]');
      const profileImage = document.querySelector('img[alt="Avatar do usuário"]');
      
      return !!(profileButton || profileImage || window.ytInitialData?.responseContext?.serviceTrackingParams?.find(p => p.service === 'youtube'));
    });
    
    if (isLoggedIn) {
      log('✓ Já está logado no YouTube');
    } else {
      log('⚠ Não está logado no YouTube — tentando acessar com conta Google...');
      // Navega para myaccount para forçar sincronização de cookies
      await page.goto('https://www.youtube.com/account', { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(2000);
      log('✓ Conta sincronizada');
    }
  } catch (err) {
    log(`Não conseguiu verificar login: ${err.message} — continuando mesmo assim`);
  }

  // Detecta e muda idioma para português brasileiro
  try {
    log('Verificando idioma da conta...');
    const isPortuguese = await page.evaluate(() => {
      const pageText = document.body.innerText;
      // Palavras comuns em português que aparecem na interface do YouTube
      const ptWords = ['Pesquisar', 'Minha biblioteca', 'Histórico', 'Começar', 'Curtir', 'Não gostei'];
      return ptWords.some(word => pageText.includes(word));
    });
    
    if (!isPortuguese) {
      log('⚠ Idioma não está em português, alterando para pt-BR...');
      await page.goto('https://www.youtube.com/?hl=pt-BR', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000); // Aguarda carregamento do novo idioma
      log('✓ Idioma alterado para português brasileiro');
    } else {
      log('✓ Interface já está em português');
    }
  } catch (err) {
    log(`Não conseguiu alterar idioma: ${err.message} — continuando mesmo assim`);
  }

  // Pesquisa
  try {
    await safeType(page, 'input#search, input[name="search_query"]', searchTerm);
    await page.keyboard.press('Enter');
    await sleep(TIMINGS.pageLoadWait);
  } catch {
    log('Campo de busca não achado, usando URL direto');
    await goToWithRetry(page, `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`, log, 2);
    await sleep(TIMINGS.pageLoadWait);
  }

  // Clica no primeiro vídeo
  log('Clicando em um vídeo');
  try {
    const videos = await page.$$('ytd-video-renderer a#video-title, a#video-title');
    if (videos.length > 0) {
      const idx = Math.floor(Math.random() * Math.min(5, videos.length));
      await videos[idx].click();
    } else {
      // Tenta seletor alternativo
      await page.click('a#video-title', { timeout: 10000 });
    }
  } catch {
    log('Não encontrou vídeo clicável, navegando para trending');
    await goToWithRetry(page, 'https://www.youtube.com/feed/trending', log, 2);
    await sleep(3000);
    try {
      await page.click('a#video-title', { timeout: 10000 });
    } catch {
      log('Não conseguiu clicar em vídeo — pulando');
      return;
    }
  }

  // Assiste por X minutos
  const watchMs = TIMINGS.youtubeWatchMinutes * 60 * 1000;
  log(`Assistindo vídeo por ${TIMINGS.youtubeWatchMinutes} minutos`);

  // Se inscreve no canal enquanto assiste
  await subscribeToChannel(page, log);

  await sleep(watchMs);

  log('YouTube concluído');
}

// ── Etapa 3: Globo.com ───────────────────────────────────────

async function browseGlobo(page, log) {
  log('Abrindo globo.com');
  try {
    await goToWithRetry(page, 'https://www.globo.com', log, 5, 60000);
  } catch (err) {
    log(`⚠ Globo.com indisponível: ${err.message}, pulando para Gmail`);
    return;
  }
  
  await sleep(TIMINGS.pageLoadWait);

  // Navega por notícias aleatórias
  const navigateMs = TIMINGS.globoNavigateMinutes * 60 * 1000;
  const startTime = Date.now();
  let newsCount = 0;

  while (Date.now() - startTime < navigateMs) {
    try {
      // Coleta links de notícias
      const newsLinks = await page.$$eval(
        'a[href*="globo.com/"]',
        (links) => links
          .map((a) => a.href)
          .filter((h) => h.includes('globo.com/') && !h.includes('javascript:') && h.length > 30)
          .slice(0, 20),
      );

      if (newsLinks.length > 0) {
        const randomLink = randomItem(newsLinks);
        log(`Abrindo notícia ${++newsCount}: ${randomLink.substring(0, 80)}…`);
        await page.goto(randomLink, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Scroll lento pela página
        await page.evaluate(() => {
          return new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300;
            const timer = setInterval(() => {
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= document.body.scrollHeight * 0.6) {
                clearInterval(timer);
                resolve();
              }
            }, 500);
          });
        });

        await sleep(randomDelay(3000, 8000));
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  log(`Globo.com concluído — ${newsCount} notícia(s) navegada(s)`);
}

// ── Etapa 4: Gmail ────────────────────────────────────────────

async function browseGmail(page, log) {
  log('Navegando no Gmail');
  
  // Apenas pula para Gmail sem tentar ler emails
  // (evita timeouts e bloqueios do Google)
  const browseMs = TIMINGS.gmailBrowseMinutes * 60 * 1000;
  log(`Aguardando ${TIMINGS.gmailBrowseMinutes} minutos...`);
  await sleep(browseMs);

  log('✓ Sessão de navegação concluída');
}

// ── Etapa 5: Criar Conta Google Ads + API Key ────────────────

/** Helper: clica no primeiro elemento encontrado dentre vários seletores */
async function clickFirst(page, selectors, label, log, timeout = 15000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout });
      log(`  ✓ [${label}] encontrado — clicando...`);
      await el.click();
      return true;
    } catch { /* próximo seletor */ }
  }
  log(`  ❌ [${label}] não encontrado`);
  return false;
}

/**
 * Acessa ads.google.com, cria conta Google Ads (captura o ID da conta),
 * depois vai ao Cloud Console criar projeto e gerar API Key.
 * Retorna { apiKey, googleAdsAccountId }.
 */
async function createGoogleAdsAccount(page, log) {
  let apiKey = null;
  let googleAdsAccountId = null;

  // ── Parte 1: Criar conta Google Ads ──────────────────────
  log('🔷 [1/3] Criando conta Google Ads...');
  try {
    await page.goto('https://ads.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomDelay(4000, 6000));

    const url0 = page.url();
    log(`📍 URL: ${url0}`);

    // Se já tem conta, pula
    if (url0.includes('ads.google.com/aw') || url0.includes('ads.google.com/home')) {
      log('✅ Conta Google Ads já existe');
    } else {
      // Clica "Começar agora"
      await clickFirst(page, [
        'xpath=//*[@id="page-content"]/div/section[1]/div[2]/div[2]/div/a[1]',
        'a:has-text("Começar agora")',
        'a:has-text("Start now")',
        'a:has-text("Get started")',
        'button:has-text("Começar agora")',
      ], 'Começar agora', log);

      await sleep(randomDelay(5000, 8000));
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
      await sleep(randomDelay(2000, 4000));
    }

    // Captura o ID da conta Google Ads (número tipo 123-456-7890)
    try {
      const adsUrl = page.url();
      log(`📍 URL pós-ads: ${adsUrl}`);
      
      // Do URL (formato /aw/overview?ocid=XXXXXXXXXX ou customerId=...)
      let urlIdMatch = adsUrl.match(/(?:ocid|customerId)=(\d+)/);
      if (urlIdMatch) {
        googleAdsAccountId = urlIdMatch[1];
      }

      // Do HTML — número formatado XXX-XXX-XXXX
      if (!googleAdsAccountId) {
        const htmlContent = await page.content();
        const idMatch = htmlContent.match(/\b(\d{3}[-\s]?\d{3}[-\s]?\d{4})\b/);
        if (idMatch) {
          googleAdsAccountId = idMatch[1].replace(/[-\s]/g, '');
        }
      }

      if (googleAdsAccountId) {
        log(`✅ Google Ads Account ID: ${googleAdsAccountId}`);
      } else {
        log('⚠️ Não conseguiu capturar ID da conta Google Ads');
      }
    } catch (err) {
      log(`⚠️ Erro ao capturar ID: ${err.message}`);
    }

    log('✅ [1/3] Concluída');
  } catch (err) {
    log(`⚠️ Erro na Parte 1: ${err.message}`);
  }

  // ── Parte 2: Cloud Console — criar projeto (se necessário) ─
  log('🔷 [2/3] Cloud Console — Credenciais...');
  try {
    await page.goto('https://console.cloud.google.com/apis/credentials', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(randomDelay(6000, 9000));

    const urlCreds = page.url();
    log(`📍 URL: ${urlCreds}`);

    // Aceita termos / modal inicial se aparecer (checkbox + botão confirmar)
    try {
      // Tenta encontrar qualquer modal/dialog com checkbox
      const checkbox = await page.$('mat-dialog-container input[type="checkbox"], mat-checkbox, [role="dialog"] input[type="checkbox"], input[type="checkbox"]');
      if (checkbox) {
        log('  Modal/termos detectada — marcando checkbox...');
        await checkbox.click();
        await sleep(1500);

        // Clica no botão de confirmar da modal
        await clickFirst(page, [
          'mat-dialog-container button:has-text("Concordar")',
          'mat-dialog-container button:has-text("Agree")',
          'mat-dialog-container button:has-text("Aceitar")',
          'mat-dialog-container button:has-text("Accept")',
          'mat-dialog-container button:has-text("OK")',
          'mat-dialog-container button:has-text("Continuar")',
          'mat-dialog-container button:has-text("Continue")',
          '[role="dialog"] button:has-text("Concordar")',
          '[role="dialog"] button:has-text("Agree")',
          '[role="dialog"] button:has-text("OK")',
          'button:has-text("Concordar")',
          'button:has-text("Agree")',
          'button:has-text("CONCORDAR E CONTINUAR")',
          'button:has-text("AGREE AND CONTINUE")',
          'button:has-text("Aceitar")',
          'button:has-text("Accept")',
        ], 'Confirmar modal', log, 8000);
        await sleep(randomDelay(3000, 5000));
        log('  ✅ Modal aceita');
      }
    } catch { /* sem modal/termos */ }

    // Pode pedir pra criar projeto
    log('  Verificando se precisa criar projeto...');
    const needsProject = await clickFirst(page, [
      'cfc-message-actions button',
      'button:has-text("Criar projeto")',
      'button:has-text("Create project")',
      'button:has-text("Create Project")',
    ], 'Criar projeto', log, 8000);

    if (needsProject) {
      await sleep(randomDelay(4000, 6000));

      // Clica no botão "Criar" do formulário de criação de projeto
      log('  Clicando no botão Criar do formulário...');
      await clickFirst(page, [
        'xpath=//*[@id="p6ntest-project-create-page"]/cfc-panel-body/cfc-virtual-viewport/div[1]/div/proj-creation-form/form/button[1]',
        'proj-creation-form form > button:first-of-type',
        'xpath=//proj-creation-form//form/button[1]',
      ], 'Criar projeto (submit)', log, 15000);

      await sleep(randomDelay(8000, 12000));
      log('  Projeto criado, aguardando...');
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await sleep(randomDelay(3000, 5000));

      // Renavega pra credenciais
      log('  Renavegando para credenciais...');
      await page.goto('https://console.cloud.google.com/apis/credentials', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(randomDelay(6000, 9000));
    }

    log('✅ [2/3] Concluída');
  } catch (err) {
    log(`⚠️ Erro na Parte 2: ${err.message}`);
  }

  // ── Parte 3: Criar chave de API ──────────────────────────
  log('🔷 [3/3] Criando chave de API...');
  try {
    const urlNow = page.url();
    log(`📍 URL: ${urlNow}`);

    // Passo 1: "Criar credenciais"
    log('  Passo 1: Criar credenciais...');
    const credsClicked = await clickFirst(page, [
      '[id$="action-bar-create-button"]',
      'xpath=//*[contains(@id, "action-bar-create-button")]',
      'button:has-text("Criar credenciais")',
      'button:has-text("Create credentials")',
    ], 'Criar credenciais', log, 15000);

    if (!credsClicked) {
      log('❌ Abortando — sem botão "Criar credenciais"');
      return { apiKey: null, googleAdsAccountId };
    }
    await sleep(randomDelay(2000, 4000));

    // Passo 2: "Chave de API" no dropdown
    log('  Passo 2: Chave de API...');
    const apiKeyClicked = await clickFirst(page, [
      'cfc-menu-item:first-of-type a',
      'cfc-menu-item a:has-text("Chave de API")',
      'cfc-menu-item a:has-text("API key")',
      'a:has-text("Chave de API")',
      'a:has-text("API key")',
      '[role="menuitem"]:has-text("Chave de API")',
      '[role="menuitem"]:has-text("API key")',
    ], 'Chave de API', log, 10000);

    if (!apiKeyClicked) {
      log('❌ Abortando — sem opção "Chave de API"');
      return { apiKey: null, googleAdsAccountId };
    }
    await sleep(randomDelay(4000, 7000));

    // Passo 3: Tipo de restrição (primeiro select)
    log('  Passo 3: Select restrição...');
    const select1 = await clickFirst(page, [
      '[id$="cfc-select-1"] > div',
      'xpath=//*[contains(@id, "cfc-select-1")]/div',
      'cfc-select:first-of-type > div',
    ], 'Select 1', log, 8000);

    if (select1) {
      await sleep(randomDelay(1500, 3000));

      // Passo 4: Selecionar opção (mat-option)
      log('  Passo 4: Opção de API...');
      await clickFirst(page, [
        'mat-option:has-text("Google Ads API")',
        'mat-option:has-text("Restringir chave")',
        'mat-option:has-text("Restrict key")',
        'mat-option:last-of-type',
      ], 'Mat-option', log, 8000);
      await sleep(randomDelay(1500, 3000));

      // Passo 5: Confirmar select (OK)
      log('  Passo 5: OK confirmar...');
      await clickFirst(page, [
        'cfc-select-ok-cancel-buttons button:last-of-type',
        'cfc-select-ok-cancel-buttons button:has-text("OK")',
        'cfc-select-ok-cancel-buttons button:nth-of-type(2)',
      ], 'OK select', log, 8000);
      await sleep(randomDelay(2000, 4000));
    }

    // Passo 6: Criar chave (botão final)
    log('  Passo 6: Botão criar chave...');
    await clickFirst(page, [
      'apis-create-api-key-subtask cfc-progress-button button',
      'cfc-progress-button button:has-text("Criar")',
      'cfc-progress-button button:has-text("Create")',
      'button:has-text("Criar chave")',
      'button:has-text("Create key")',
    ], 'Criar chave', log, 10000);
    await sleep(randomDelay(5000, 10000));

    // Passo 7: Capturar a chave
    log('  Passo 7: Capturando chave...');

    // mat-form-field input
    try {
      const matInput = await page.$('apis-create-api-key-subtask mat-form-field input');
      if (matInput) {
        apiKey = await matInput.inputValue();
        if (apiKey) log(`  ✓ Chave de mat-form-field input: ${apiKey.slice(0, 15)}...`);
      }
    } catch {}

    // mat-form-field textarea
    if (!apiKey) {
      try {
        const matTa = await page.$('apis-create-api-key-subtask mat-form-field textarea');
        if (matTa) {
          apiKey = await matTa.evaluate(el => el.value);
          if (apiKey) log(`  ✓ Chave de mat-form-field textarea: ${apiKey.slice(0, 15)}...`);
        }
      } catch {}
    }

    // Qualquer input com AIza
    if (!apiKey) {
      try {
        const inputs = await page.$$('input[type="text"], textarea, input[readonly]');
        for (const inp of inputs) {
          const val = await inp.inputValue().catch(() => inp.evaluate(el => el.value));
          if (val && val.startsWith('AIza')) {
            apiKey = val.trim();
            log(`  ✓ Chave de input genérico: ${apiKey.slice(0, 15)}...`);
            break;
          }
        }
      } catch {}
    }

    // Regex no HTML
    if (!apiKey) {
      try {
        const html = await page.content();
        const m = html.match(/AIza[A-Za-z0-9_-]{35,39}/);
        if (m) {
          apiKey = m[0];
          log(`  ✓ Chave do HTML: ${apiKey.slice(0, 15)}...`);
        }
      } catch {}
    }

    if (apiKey) {
      apiKey = apiKey.trim();
      log(`✅ API Key: ${apiKey.slice(0, 10)}...`);
    } else {
      log('❌ Não foi possível capturar a chave');
    }
  } catch (err) {
    log(`⚠️ Erro na Parte 3: ${err.message}`);
  }

  log(`📊 Resultado — Key: ${apiKey ? apiKey.slice(0, 10) + '...' : 'NÃO'} | Ads ID: ${googleAdsAccountId || 'NÃO'}`);
  return { apiKey, googleAdsAccountId };
}

// ── Executor principal ────────────────────────────────────────

/**
 * Executa uma sessão completa de aquecimento para uma conta.
 *
 * @param {{ id: string, email: string, password: string, proxy: string }} account
 * @param {(msg: string) => void} log - callback de log
 * @returns {{ success: boolean, error?: string }}
 */
export async function runWarmupSession(account, log = console.log, dayNumber = 1) {
  const profilePath = join(PROFILES_DIR, account.id);

  // Garante diretório do perfil
  if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

  const proxyConfig = parseProxy(account.proxy);
  let proxyForBrowser = null;
  let proxyTunnel = null;

  // Log para debugging
  if (account.proxy) {
    log(`[DEBUG] Proxy string: ${account.proxy}`);
    log(`[DEBUG] Parsed: type=${proxyConfig?.type}, host=${proxyConfig?.host}, hasAuth=${proxyConfig?.hasAuth}`);
  }

  // Configura proxy para o browser
  if (proxyConfig) {
    if (proxyConfig.type === 'socks5' && proxyConfig.hasAuth) {
      // SOCKS5 com autenticação: cria tunnel HTTP local
      try {
        log(`Criando tunnel SOCKS5 com autenticação...`);
        proxyTunnel = await createSocksProxyTunnel(
          proxyConfig.host,
          proxyConfig.port,
          proxyConfig.username,
          proxyConfig.password
        );
        proxyForBrowser = { server: proxyTunnel.url };
        log(`✓ Tunnel criado: ${proxyTunnel.url}`);
      } catch (err) {
        throw new Error(`Falha ao criar tunnel SOCKS5: ${err.message}`);
      }
    } else if (proxyConfig.type === 'socks5') {
      // SOCKS5 sem autenticação: usar direto
      proxyForBrowser = { server: `socks5://${proxyConfig.host}:${proxyConfig.port}` };
      log(`Usando proxy SOCKS5 (sem auth): ${proxyForBrowser.server}`);
    } else {
      // HTTP com ou sem autenticação
      if (proxyConfig.username && proxyConfig.password) {
        // Cria proxy com autenticação básica embutida na URL
        const encodedAuth = Buffer.from(`${proxyConfig.username}:${proxyConfig.password}`).toString('base64');
        proxyForBrowser = {
          server: `http://${proxyConfig.host}:${proxyConfig.port}`,
          username: proxyConfig.username,
          password: proxyConfig.password,
        };
        log(`Usando proxy HTTP com autenticação: ${proxyConfig.host}:${proxyConfig.port} (${proxyConfig.username})`);
      } else {
        proxyForBrowser = {
          server: `http://${proxyConfig.host}:${proxyConfig.port}`,
        };
        log(`Usando proxy HTTP (sem auth): ${proxyConfig.host}:${proxyConfig.port}`);
      }
    }
  } else {
    log('⚠️ Nenhum proxy configurado - usando conexão direta');
  }

  const launchOpts = {
    headless: process.env.HEADLESS === 'true',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-default-apps',
    ],
  };
  if (proxyForBrowser) {
    launchOpts.proxy = proxyForBrowser;
  }

  let context = null;

  try {
    log(`Iniciando browser para ${account.email}`);
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await sleep(TIMINGS.browserStartupWait);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);

    // 1. Login
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail);

    // 1b. Criar canal no YouTube (apenas no dia 1)
    if (dayNumber === 1) {
      await createYouTubeChannel(page, log);
    }

    // 2. YouTube
    await browseYouTube(page, log);

    // 3. Globo.com
    await browseGlobo(page, log);

    // 4. Gmail
    await browseGmail(page, log);

    // 5. Google Ads + API Key (último dia — cria a conta e gera chave)
    let googleAdsApiKey = null;
    let googleAdsAccountId = null;
    if (dayNumber >= TIMINGS.warmupDays) {
      const adsResult = await createGoogleAdsAccount(page, log);
      googleAdsApiKey = adsResult.apiKey;
      googleAdsAccountId = adsResult.googleAdsAccountId;
    }

    // Salva cookies do perfil para exportação posterior
    try {
      const cookies = await context.cookies();
      const cookiesPath = join(profilePath, 'cookies.json');
      const { writeFileSync } = await import('fs');
      writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      log(`✓ Cookies salvos (${cookies.length} cookies)`);
    } catch (e) {
      log(`⚠️ Não foi possível salvar cookies: ${e.message}`);
    }

    log(`Sessão de aquecimento concluída para ${account.email}`);
    return { success: true, googleAdsApiKey, googleAdsAccountId };

  } catch (err) {
    log(`ERRO no aquecimento de ${account.email}: ${err.message}`);
    return { success: false, error: err.message };

  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignora */ }
    }
    if (proxyTunnel) {
      try {
        await proxyTunnel.close();
        log('✓ Tunnel SOCKS5 fechado');
      } catch { /* ignora */ }
    }
  }
}

// ── Executa APENAS o fluxo Google Ads + API Key ───────────────

/**
 * Abre browser com o perfil da conta, faz login e executa apenas
 * o fluxo de criação de conta Google Ads + geração de API Key.
 */
export { loginGoogle, clickFirst, sleep, parseProxy, PROFILES_DIR };

export async function runGoogleAdsOnly(account, log = console.log) {
  const profilePath = join(PROFILES_DIR, account.id);
  if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

  const proxyConfig = parseProxy(account.proxy);
  let proxyForBrowser = null;
  let proxyTunnel = null;

  if (proxyConfig) {
    if (proxyConfig.type === 'socks5' && proxyConfig.hasAuth) {
      try {
        log(`Criando tunnel SOCKS5 com autenticação...`);
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
    log(`Iniciando browser para ${account.email} (Google Ads only)...`);
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await sleep(TIMINGS.browserStartupWait);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);

    // Login
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail);

    // Só o fluxo Google Ads + API Key
    const adsResult = await createGoogleAdsAccount(page, log);

    // Salva cookies atualizados
    try {
      const cookies = await context.cookies();
      const cookiesPath = join(profilePath, 'cookies.json');
      const { writeFileSync } = await import('fs');
      writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      log(`✓ Cookies salvos (${cookies.length} cookies)`);
    } catch (e) {
      log(`⚠️ Não foi possível salvar cookies: ${e.message}`);
    }

    return { success: true, googleAdsApiKey: adsResult.apiKey, googleAdsAccountId: adsResult.googleAdsAccountId };
  } catch (err) {
    log(`ERRO no fluxo Google Ads de ${account.email}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignora */ }
    }
    if (proxyTunnel) {
      try { await proxyTunnel.close(); } catch { /* ignora */ }
    }
  }
}
