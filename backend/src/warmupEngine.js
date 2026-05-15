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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { TIMINGS, YOUTUBE_SEARCH_TERMS, randomDelay, randomItem } from './warmupTimings.js';
import { createSocksProxyTunnel } from './socksProxy.js';
import { generateTOTP } from './totp.js';
import { broadcast } from './events.js';
import { updateAccount } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, '../../data/profiles');
const CARDS_PATH = join(__dirname, '../data/cards.json');
// Garante diretório de perfis
if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });

let _lastCardNum = null; // evita repetir o último cartão sorteado

/** Retorna um cartão aleatório com status Ativado, sem repetir o último */
function getNextCard() {
  if (!existsSync(CARDS_PATH)) return null;
  const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf-8'));
  let available = cards.filter(c => c.status === 'Ativado' && c.numero_cartao !== _lastCardNum);
  if (!available.length) available = cards.filter(c => c.status === 'Ativado'); // fallback: ignora filtro
  if (!available.length) return null;
  const card = available[Math.floor(Math.random() * available.length)];
  _lastCardNum = card.numero_cartao;
  return card;
}

/** Marca um cartão como usado no cards.json */
function markCardUsed(numeroCartao) {
  if (!existsSync(CARDS_PATH)) return;
  const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf-8'));
  const card = cards.find(c => c.numero_cartao === numeroCartao);
  if (card) {
    card.usado = true;
    writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
  }
}

/** Lista de ZIP codes americanos para preencher o campo CEP */
const US_ZIP_CODES = [
  '10001', '90001', '60601', '77001', '85001',
  '19101', '78201', '92101', '75201', '95101',
  '30301', '98101', '02101', '80201', '33101',
  '28201', '37201', '48201', '55401', '63101',
];

/** Lista de nomes de organização para preencher o formulário */
const ORG_NAMES = [
  'Ultrafarme Digital', 'Marketing Pro Solutions', 'Global Media Services',
  'Digital Growth Corp', 'Ads Marketing Brazil', 'ProMedia Group',
  'Digital Ventures LLC', 'Media Solutions Co', 'Growth Marketing Inc',
  'Digital Ads Agency', 'WebMedia Solutions', 'OnlineMedia Corp',
  'BrightAds Network', 'ClickBoost Media', 'PrimeAds Solutions',
];

function getRandomZip() {
  return US_ZIP_CODES[Math.floor(Math.random() * US_ZIP_CODES.length)];
}

function getRandomOrgName() {
  return ORG_NAMES[Math.floor(Math.random() * ORG_NAMES.length)];
}

// ── Stealth browser config ────────────────────────────────────

const STEALTH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function buildLaunchOpts(proxyForBrowser = null) {
  const opts = {
    headless: process.env.HEADLESS !== 'false',
    userAgent: STEALTH_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--window-size=1366,768',
      '--lang=pt-BR',
      '--disable-notifications',
    ],
  };
  if (proxyForBrowser) opts.proxy = proxyForBrowser;
  return opts;
}

async function applyStealthScripts(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
    if (!window.chrome) {
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };
    }
    // Sobrescreve toString de funções automação para parecer nativo
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });
}

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

async function loginGoogle(page, email, password, log, recoveryEmail = '', totpSecret = '') {
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

    // ── CAPTCHA / "Não sou um robô" ──────────────────────────────
    const isCaptchaUrl = currentUrl.includes('google.com/sorry') ||
      currentUrl.includes('/challenge/ipp') ||
      currentUrl.includes('recaptcha');
    const isCaptchaText = /não sou um rob[oô]|i.?m not a robot|verificar que você não é um rob[oô]|confirme que não é um rob[oô]|prove you.?re not a robot|complete.*captcha|recaptcha/i.test(bodyText);
    const hasCaptchaElement = await page.evaluate(() =>
      !!(document.querySelector('iframe[src*="recaptcha"], #recaptcha, .recaptcha-checkbox, #rc-anchor-container, .g-recaptcha, [data-sitekey]'))
    ).catch(() => false);

    if (isCaptchaUrl || isCaptchaText || hasCaptchaElement) {
      log('🤖 CAPTCHA / verificação "não sou um robô" detectada! Aguardando resolução manual...');
      broadcast('captcha_required', { email, round, message: `CAPTCHA detectado na conta ${email} — resolva no browser aberto e o processo continuará automaticamente.` });

      const CAPTCHA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
      const captchaStart = Date.now();
      let captchaSolved = false;
      let lastLogAt = 0;

      while (Date.now() - captchaStart < CAPTCHA_TIMEOUT_MS) {
        await sleep(4000);
        const nowUrl = page.url();
        const stillCaptcha = nowUrl.includes('google.com/sorry') ||
          nowUrl.includes('/challenge/ipp') ||
          nowUrl.includes('recaptcha') ||
          await page.evaluate(() =>
            !!(document.querySelector('iframe[src*="recaptcha"], #recaptcha, .recaptcha-checkbox, #rc-anchor-container, .g-recaptcha, [data-sitekey]'))
          ).catch(() => false);

        if (!stillCaptcha) {
          captchaSolved = true;
          log('  ✓ CAPTCHA resolvido! Retomando fluxo de login...');
          broadcast('captcha_resolved', { email });
          break;
        }

        const elapsed = Math.round((Date.now() - captchaStart) / 1000);
        if (Date.now() - lastLogAt > 30000) { // loga a cada 30s
          log(`  ⏳ Aguardando resolução do CAPTCHA... (${elapsed}s / 300s)`);
          lastLogAt = Date.now();
        }
      }

      if (!captchaSolved) {
        broadcast('captcha_timeout', { email });
        throw new Error(`CAPTCHA não resolvido em 5 minutos para ${email} — abortando`);
      }
      await sleep(2000);

      // ── Após CAPTCHA: verifica se agora apareceu campo de senha ──
      // (o CAPTCHA pode ter substituído o campo de senha; após resolver, precisa digitá-la)
      try {
        const passAfterCaptcha = await page.waitForSelector('input[type="password"]', {
          visible: true, timeout: 7000
        });
        log('  🔑 Campo de senha apareceu após CAPTCHA — digitando...');
        await passAfterCaptcha.click({ clickCount: 3 });
        await passAfterCaptcha.type(password, { delay: TIMINGS.typingDelay });
        await sleep(500);
        await page.keyboard.press('Enter');
        log('  ✓ Senha enviada pós-CAPTCHA');
        await sleep(TIMINGS.loginWaitAfter || 4000);

        // ── Verifica TOTP imediatamente após a senha ──
        const postPassUrl = page.url();
        const postPassBody = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        const needsTOTPNow =
          /challenge\/totp/i.test(postPassUrl) ||
          /autenticador|authenticator|google authenticator|app de autenticação|authentication app|insira.*código.*autenticador|enter.*code.*authenticator|código.*6.*dígitos|6.digit.*code/i.test(postPassBody) ||
          await page.evaluate(() => !!document.querySelector('input[autocomplete="one-time-code"], input[inputmode="numeric"]')).catch(() => false);

        if (needsTOTPNow && totpSecret) {
          log('  🔐 TOTP detectado logo após senha pós-CAPTCHA — gerando código...');
          try {
            const totpCode = generateTOTP(totpSecret);
            log(`  Código TOTP: ${totpCode}`);
            const totpInput = await page.waitForSelector(
              'input[type="tel"], input[type="number"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
              { visible: true, timeout: 8000 }
            ).catch(() => null);
            if (totpInput) {
              await totpInput.click({ clickCount: 3 });
              await sleep(200);
              await totpInput.type(totpCode, { delay: TIMINGS.typingDelay });
              await sleep(400);
              await page.keyboard.press('Enter');
              log('  ✓ Código TOTP enviado pós-CAPTCHA!');
              await sleep(4000);
            }
          } catch (e) {
            log(`  ⚠ Erro TOTP pós-CAPTCHA: ${e.message}`);
          }
        } else if (needsTOTPNow && !totpSecret) {
          throw new Error('2FA (autenticador) necessário e sem chave TOTP configurada');
        }
      } catch {
        log('  Campo de senha não apareceu após CAPTCHA — continuando loop...');
      }
      continue;
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

    // ── TOTP / Autenticador (verificado ANTES do skip para não dispensar a tela) ──
    const isTOTPChallenge =
      /challenge\/totp/i.test(currentUrl) ||
      /autenticador|authenticator|google authenticator|app de autenticação|authentication app|insira.*código.*autenticador|enter.*code.*authenticator|código.*6.*dígitos|6.digit.*code|insira.*código de 6/i.test(bodyText) ||
      await page.evaluate(() => !!document.querySelector('input[autocomplete="one-time-code"], input[inputmode="numeric"]')).catch(() => false);

    if (isTOTPChallenge && totpSecret) {
      log('  🔐 Desafio do autenticador detectado — gerando código TOTP...');
      try {
        const totpCode = generateTOTP(totpSecret);
        log(`  Código TOTP: ${totpCode}`);
        const codeInput = await page.waitForSelector(
          'input[type="tel"], input[type="number"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
          { visible: true, timeout: 8000 }
        ).catch(() => null);

        if (codeInput) {
          await codeInput.click({ clickCount: 3 });
          await sleep(200);
          await codeInput.type(totpCode, { delay: TIMINGS.typingDelay });
          await sleep(400);
          await page.keyboard.press('Enter');
          log('  ✓ Código TOTP enviado!');
          await sleep(4000);
          continue;
        } else {
          // Fallback: qualquer input numérico visível
          const inserted = await page.evaluate((code) => {
            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
            const vis = inputs.find(i => i.offsetParent !== null && i.type !== 'password' && i.type !== 'email');
            if (vis) {
              vis.focus(); vis.value = '';
              vis.dispatchEvent(new Event('input', { bubbles: true }));
              for (const ch of code) { vis.value += ch; vis.dispatchEvent(new Event('input', { bubbles: true })); }
              vis.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }, totpCode);
          if (inserted) { await page.keyboard.press('Enter'); log('  ✓ TOTP via fallback'); await sleep(4000); continue; }
          log('  ⚠ Campo de código TOTP não encontrado');
        }
      } catch (totpErr) {
        log(`  ⚠ Erro ao gerar TOTP: ${totpErr.message}`);
      }
    } else if (isTOTPChallenge && !totpSecret) {
      log('  ⚠ Desafio do autenticador sem chave TOTP configurada — abortando');
      throw new Error('2FA (autenticador) necessário e sem chave TOTP configurada');
    }

    // Tenta SKIP genérico (só se não é tela de código 2FA)
    if (!isTOTPChallenge) {
      const skipped = await clickButtonByText(page, SKIP_PATTERNS);
      if (skipped) {
        log(`  ✓ Skip: "${skipped}"`);
        await sleep(3000);
        continue;
      }
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

// ── Trocar idioma da conta Google para Português do Brasil ──

async function changeLanguageToPortuguese(page, log) {
  log('🌎 Verificando idioma da conta...');
  try {
    // 1. Vai direto para a página de idioma
    await page.goto('https://myaccount.google.com/language', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomDelay(3000, 5000));

    const currentUrl = page.url();
    log(`  📍 URL: ${currentUrl}`);

    // 2. Verifica se já está em português — lê o texto da página
    if (currentUrl.includes('myaccount.google.com')) {
      const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const alreadyPortuguese =
        /\bidioma\b/i.test(pageText) ||          // título "Idioma" em PT
        /português.*brasil/i.test(pageText) ||   // idioma atual exibido
        /pt-br/i.test(pageText);                  // código de idioma visível

      if (alreadyPortuguese) {
        log('✓ Idioma já está em português — pulando alteração');
        return;
      }
      log('  ⚠️ Idioma não está em português, iniciando alteração...');
    }

    // Se redirecionou para login ou outra página, tenta o caminho completo
    if (!currentUrl.includes('myaccount.google.com')) {
      log('  ⚠️ Redirecionado, tentando caminho alternativo...');
      await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(3000, 5000));

      // Clica em "Informações pessoais"
      log('  → Clicando em Informações pessoais...');
      await clickFirst(page, [
        'a[href*="personal-info"]',
        'a:has-text("Informações pessoais")',
        'a:has-text("Personal info")',
      ], 'Informações pessoais', log, 15000);
      await sleep(randomDelay(3000, 5000));

      // Clica em "Idioma"
      log('  → Clicando em Idioma...');
      await clickFirst(page, [
        'a[href*="language"]',
        'a:has-text("Idioma")',
        'a:has-text("Language")',
      ], 'Idioma', log, 15000);
      await sleep(randomDelay(3000, 5000));
    }

    // 2. Clica no botão de editar idioma (ícone de lápis/edit)
    log('  → Clicando em Editar idioma...');
    await clickFirst(page, [
      'button[aria-label*="Editar"]',
      'button[aria-label*="Edit"]',
      'xpath=//ul/li//span/button',
      'xpath=//ul/li//button[contains(@class,"edit")]',
      'xpath=//ul/li//button',
    ], 'Editar idioma', log, 15000);
    await sleep(randomDelay(3000, 5000));

    // 3. Digita "portugues" no campo de busca (tenta vários IDs dinâmicos)
    log('  → Digitando "portugues" no campo de busca...');
    let searchInput = null;
    
    // Tenta encontrar o input por vários métodos
    const inputSelectors = [
      'xpath=//*[@id="c13"]',
      'xpath=//*[@id="c11"]',
      'xpath=//*[@id="c15"]',
      'xpath=//*[@id="c9"]',
      // Seletores semânticos mais confiáveis
      '[role="dialog"] input[type="text"]',
      '[role="dialog"] input[type="search"]',
      '[role="dialog"] input',
      '[role="combobox"]',
      'input[aria-autocomplete="list"]',
    ];
    
    for (const sel of inputSelectors) {
      try {
        const el = await page.waitForSelector(sel, { visible: true, timeout: 3000 });
        if (el) {
          searchInput = el;
          log(`  ✓ Campo encontrado: ${sel}`);
          break;
        }
      } catch { /* próximo */ }
    }
    
    if (!searchInput) {
      log('  ⚠️ Nenhum campo de busca encontrado, tentando fallback genérico...');
      searchInput = await page.waitForSelector('input', { visible: true, timeout: 5000 });
    }

    if (searchInput) {
      await searchInput.click({ clickCount: 3 });
      await sleep(300);
      await searchInput.type('portugues', { delay: TIMINGS.typingDelay });
      log('  ✅ Digitou "portugues"');
      await sleep(randomDelay(2000, 3000));

      // 4. Seleciona "Português" na lista de resultados
      log('  → Selecionando Português na lista...');
      await clickFirst(page, [
        'xpath=//*[@id="ucc-5"]',
        'xpath=//*[@id="ucc-3"]',
        'xpath=//*[@id="ucc-7"]',
        // Seletores semânticos
        '[role="option"]:has-text("português")',
        '[role="option"]:has-text("Português")',
        'li:has-text("português")',
        ':text-is("português")',
        ':text("Português")',
      ], 'Português', log, 10000);
      await sleep(randomDelay(3000, 5000));
    } else {
      log('  ❌ Não conseguiu encontrar campo de busca');
    }

    // 5. Modal de região — seleciona "Brasil"
    log('  → Selecionando Brasil na modal de região...');
    const brasilClicked = await clickFirst(page, [
      '[role="option"]:has-text("Brasil")',
      '[role="option"]:has-text("Brazil")',
      'li:has-text("Brasil")',
      ':text-is("Brasil")',
      ':text("Brasil")',
      ':text("Brazil")',
    ], 'Brasil', log, 15000);
    
    if (brasilClicked) {
      log('  ✓ Brasil selecionado — aguardando modal fechar...');
      // Aguarda a opção ser aplicada (modal fecha ou estado muda)
      await sleep(randomDelay(3000, 5000));
      // Garante que o DOM está estável antes de procurar o botão Salvar
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
      await sleep(1000);
    } else {
      log('  ⚠️ Brasil não foi selecionado — tentando salvar mesmo assim');
      await sleep(randomDelay(2000, 3000));
    }

    // 6. Clica no botão "Salvar" — usa o último botão da modal (mais confiável)
    log('  → Clicando no botão Salvar...');

    // Estratégia primária: último botão visível no modal de idioma (conforme XPath informado)
    let saved = await page.evaluate(() => {
      // Pega todos os botões visíveis
      const allBtns = Array.from(document.querySelectorAll('button'));
      const visible = allBtns.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && b.offsetParent !== null;
      });
      // O botão Salvar é o último botão visível
      const last = visible[visible.length - 1];
      if (last) { last.click(); return last.textContent?.trim() || 'último botão'; }
      return null;
    });

    if (saved) {
      log(`  ✓ Clicou no último botão: "${saved}"`);
    } else {
      // Fallback: XPath exato fornecido + variantes de div[N]
      saved = await clickFirst(page, [
        'xpath=//*[@id="yDmH0d"]/div[16]/div[2]/div/div[2]/div[3]/button/span[3]',
        'xpath=//*[@id="yDmH0d"]/div[17]/div[2]/div/div[2]/div[3]/button/span[3]',
        'xpath=//*[@id="yDmH0d"]/div[15]/div[2]/div/div[2]/div[3]/button/span[3]',
        'xpath=//*[@id="yDmH0d"]/div[18]/div[2]/div/div[2]/div[3]/button/span[3]',
        'button:has-text("Salvar")',
        'button:has-text("Save")',
        '[role="button"]:has-text("Salvar")',
        '[role="button"]:has-text("Save")',
      ], 'Salvar', log, 10000);
    }
    await sleep(randomDelay(3000, 4000));

    // 7. Segundo botão de salvar (confirmação final, se existir)
    log('  → Verificando se há segundo botão Salvar...');
    const saved2 = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll('button'));
      const visible = allBtns.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && b.offsetParent !== null;
      });
      const last = visible[visible.length - 1];
      if (last) { last.click(); return last.textContent?.trim() || 'último botão'; }
      return null;
    });
    
    if (saved2) {
      log(`  ✓ Segundo Salvar: "${saved2}"`);
      await sleep(randomDelay(3000, 5000));
    }

    log('✅ Idioma alterado para Português do Brasil!');
  } catch (err) {
    log(`⚠️ Erro ao trocar idioma: ${err.message} — continuando`);
  }
}

/** Helper: detecta qual etapa da campanha está visível */
async function detectCurrentStage(page, log) {
  try {
    // Verifica quais wrappers estão VISÍVEIS (não apenas presentes no DOM)
    // Detecta tela de pagamento (language-neutral via atributo estável)
    try {
      const paymentEl = await page.$('[jscontroller="J5ul1"], [jsmodel="nf3d5d"]');
      if (paymentEl && await paymentEl.isVisible()) return 'payment';
    } catch { /* ignora */ }

    const stages = [
      { name: 'business-name', selectors: 'business-name-view-for-chat, business-name-wrapper' },
      { name: 'business-insights', selectors: 'business-insights-wrapper' },
      { name: 'linking', selectors: 'linking-wrapper' },
      { name: 'campaign-goals', selectors: 'campaign-goals-wrapper' },
      { name: 'campaign-type', selectors: 'campaign-type-wrapper, campaign-subtype-wrapper' },
      { name: 'expert', selectors: 'expert-wrapper' },
    ];

    for (const stage of stages) {
      try {
        const el = page.locator(stage.selectors).first();
        if (await el.isVisible({ timeout: 1000 })) {
          return stage.name;
        }
      } catch { /* não visível */ }
    }
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

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
 * cria campanha (pula tudo), configura pagamento com cartão,
 * depois vai ao Cloud Console criar projeto e gerar API Key.
 * Retorna { apiKey, googleAdsAccountId }.
 */
async function createGoogleAdsAccount(page, log, account = {}) {
  let apiKey = null;
  let googleAdsAccountId = null;

  // ── Parte 1: Criar conta Google Ads ──────────────────────
  log('🔷 [1/5] Criando conta Google Ads...');
  try {
    await page.goto('https://ads.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomDelay(4000, 6000));

    const url0 = page.url();
    log(`📍 URL: ${url0}`);

    // /aw/ = interface de gerenciamento (conta já existe)
    // /home = landing page pública (ainda precisa criar conta)
    const adsAccountExists = url0.includes('ads.google.com/aw/');
    if (adsAccountExists) {
      log('✅ Conta Google Ads já existe (URL /aw/)');
    } else {
      // Clica "Começar agora" (landing page ou /home)
      log('  → Clicando em Começar agora...');
      const startNowClicked = await clickFirst(page, [
        'xpath=//*[@id="page-content"]/div/section[1]/div[2]/div[2]/div/a[1]',
        'a:has-text("Começar agora")',
        'a:has-text("Start now")',
        'a:has-text("Get started")',
        'button:has-text("Começar agora")',
        'button:has-text("Start now")',
        'button:has-text("Get started")',
        'a[href*="aw/signup"]',
        'a[href*="aw/overview"]',
      ], 'Começar agora', log, 15000);

      if (!startNowClicked) {
        const clickedByText = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"]'))
            .filter(el => el.offsetParent !== null);
          const patterns = [/começar agora/i, /start now/i, /get started/i, /criar campanha/i, /create campaign/i];
          for (const pattern of patterns) {
            const el = all.find(node => pattern.test((node.textContent || '').trim()));
            if (el) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return (el.textContent || '').trim().substring(0, 80);
            }
          }
          return null;
        }).catch(() => null);

        if (clickedByText) {
          log(`  ✅ Clique por texto na landing: "${clickedByText}"`);
        } else {
          log('  ⚠️ Não encontrou CTA de entrada — navegando direto para /aw/signup');
          await page.goto('https://ads.google.com/aw/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
      }

      await sleep(randomDelay(5000, 8000));
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
      await sleep(randomDelay(2000, 4000));
    }

    log('✅ [1/5] Concluída');  // ID da conta será capturado após configurar pagamento
  } catch (err) {
    log(`⚠️ Erro na Parte 1: ${err.message}`);
  }

  // ── Parte 2: Wizard de campanha + seleção de moeda ──────
  log('🔷 [2/5] Criando campanha e configurando pagamento...');
  try {
    // Garante que está no Google Ads
    if (!page.url().includes('ads.google.com')) {
      await page.goto('https://ads.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(4000, 6000));
    }

    const urlPart2 = page.url();
    log(`  📍 URL início Part 2: ${urlPart2}`);

    // ── Onde estamos? ──────────────────────────────────────
    // Caso 1: já na tela de pagamento
    // Caso 2: já no wizard
    // Caso 3: landing/home do Ads (precisa entrar no wizard)

    const isPaymentScreen = async () => {
      return await page.waitForSelector(
        '[jscontroller="J5ul1"], [jsmodel="nf3d5d"], #payments-signup-iframe-containerIframe',
        { state: 'attached', timeout: 3000 }
      ).then(() => true).catch(() => false);
    };

    const isWizardContext = (url) => url.includes('aw/signup') || url.includes('currentStep=');

    let alreadyOnPaymentScreen = await isPaymentScreen();
    let alreadyInWizard = isWizardContext(urlPart2) || (await detectCurrentStage(page, log)) !== 'unknown';

    if (alreadyOnPaymentScreen) {
      log('  ✅ Já na tela de pagamento — pulando wizard inteiro');
    } else {
      if (!alreadyInWizard) {
        log('  → Garantindo entrada no wizard de campanha...');
        let enteredWizard = false;
        const ENTRY_FALLBACK_URLS = [
          'https://ads.google.com/aw/signup',
          'https://ads.google.com/aw/campaigns/new',
        ];

        for (let attempt = 1; attempt <= 4 && !enteredWizard; attempt++) {
          log(`  → Tentativa ${attempt}/4 de entrar no wizard...`);

          const campaignClicked = await clickFirst(page, [
            'button:has-text("Criar sua primeira campanha")',
            'button:has-text("Create your first campaign")',
            'a:has-text("Criar sua primeira campanha")',
            'a:has-text("Create your first campaign")',
            'button:has-text("Criar campanha")',
            'button:has-text("Create campaign")',
            'a:has-text("Nova campanha")',
            'button:has-text("Nova campanha")',
            'a:has-text("Começar agora")',
            'a:has-text("Start now")',
            'button:has-text("Começar agora")',
            'button:has-text("Start now")',
          ], 'Entrada wizard', log, 8000);

          if (!campaignClicked) {
            const clickedByText = await page.evaluate(() => {
              const all = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"], material-button'))
                .filter(el => el.offsetParent !== null);
              const patterns = [
                /criar sua primeira campanha/i,
                /create your first campaign/i,
                /criar campanha/i,
                /create campaign/i,
                /nova campanha/i,
                /new campaign/i,
                /começar agora/i,
                /start now/i,
                /get started/i,
              ];
              for (const pattern of patterns) {
                const el = all.find(node => pattern.test((node.textContent || '').trim()));
                if (el) {
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  return (el.textContent || '').trim().substring(0, 80);
                }
              }
              return null;
            }).catch(() => null);
            if (clickedByText) log(`  ✅ Clique por texto (fallback): "${clickedByText}"`);
          }

          await sleep(randomDelay(3000, 5000));
          const stageAfterClick = await detectCurrentStage(page, log);
          if (await isPaymentScreen() || isWizardContext(page.url()) || stageAfterClick !== 'unknown') {
            enteredWizard = true;
            break;
          }

          if (attempt % 2 === 0) {
            for (const fallbackUrl of ENTRY_FALLBACK_URLS) {
              log(`  ⚠️ Tentando URL fallback: ${fallbackUrl}`);
              await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await sleep(randomDelay(3000, 5000));

              const stageAfterGoto = await detectCurrentStage(page, log);
              if (await isPaymentScreen() || isWizardContext(page.url()) || stageAfterGoto !== 'unknown') {
                enteredWizard = true;
                break;
              }
            }
          }
        }

        if (!enteredWizard) {
          log('  ⚠️ Não confirmou entrada no wizard automaticamente; tentando seguir com loop principal...');
        }
      } else {
        log('  ✅ Já no wizard — entrando direto no loop de etapas');
        await sleep(randomDelay(2000, 3000));
      }

      alreadyOnPaymentScreen = await isPaymentScreen();
      alreadyInWizard = isWizardContext(page.url()) || (await detectCurrentStage(page, log)) !== 'unknown';
      if (!alreadyOnPaymentScreen && !alreadyInWizard) {
        throw new Error('Não foi possível entrar no wizard/tela de pagamento do Google Ads');
      }

      // ── Loop do wizard de campanha ─────────────────────────
      let maxSteps = 20;
      let stepCount = 0;
      let previousStage = '';
      let stuckCount = 0;

      // Fecha modal de onboarding que pode aparecer ao entrar no wizard
      try {
        const onboardingBtn = await page.waitForSelector(
          'xpath=//*[@id="base-root-overlay-container-ACCOUNT_ONBOARDING"]/div[1]/material-dialog/focus-trap/div[2]/div/div[2]/div/button/div[2]',
          { state: 'visible', timeout: 5000 }
        );
        if (onboardingBtn) {
          await onboardingBtn.click();
          log('  ✅ Modal de onboarding fechado');
          await sleep(randomDelay(1500, 2500));
        }
      } catch { /* modal não apareceu — ok */ }

      while (stepCount < maxSteps) {
        stepCount++;

        // Checa se a tela de pagamento já apareceu (interrompe o loop)
        const paymentNow = await page.waitForSelector(
          '[jscontroller="J5ul1"]', { state: 'visible', timeout: 2000 }
        ).then(() => true).catch(() => false);
        if (paymentNow) {
          log('  ✅ Tela de pagamento detectada — saindo do loop');
          break;
        }

        const currentStage = await detectCurrentStage(page, log);
        log(`  📍 Etapa: ${currentStage} (passo ${stepCount}/${maxSteps})`);

        // Modal "Sair da criação de campanha?" — confirma automaticamente
        try {
          const exitModalBtn = await page.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll('material-dialog'));
            for (const dialog of dialogs) {
              const style = window.getComputedStyle(dialog);
              if (style.display === 'none' || style.visibility === 'hidden') continue;
              const yesBtn = dialog.querySelector('material-yes-no-buttons material-button:first-of-type');
              if (!yesBtn) continue;
              const text = (yesBtn.textContent || '').trim().toLowerCase();
              if (/sair|exit|sim|yes|confirmar|confirm|deixar|leave/i.test(text)) {
                yesBtn.click(); return text;
              }
            }
            return null;
          });
          if (exitModalBtn) {
            log(`  ✅ Modal "sair" confirmado: "${exitModalBtn}"`);
            await sleep(randomDelay(2000, 3000));
            continue;
          }
        } catch { /* ignora */ }

        // Anti-loop
        if (currentStage === previousStage) {
          stuckCount++;
          if (stuckCount === 3 && currentStage === 'unknown') {
            log('  ⚠️ Etapa desconhecida repetida — tentando reabrir wizard por URL...');
            await page.goto('https://ads.google.com/aw/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(randomDelay(3000, 5000));
            continue;
          }
          if (stuckCount >= 6) {
            log(`  ⚠️ Preso em "${currentStage}" — saindo do loop`);
            break;
          }
        } else {
          stuckCount = 0;
        }
        previousStage = currentStage;

        if (currentStage === 'business-name') {
          log('  → Preenchendo URL do site...');
          try {
            let urlInput = null;
            for (const sel of [
              'input[type="url"]',
              'input[type="text"][aria-label*="URL"]',
              'input[type="text"][aria-label*="site"]',
              'input[type="text"][aria-label*="url"]',
              'xpath=(//business-name-wrapper//material-input//input)[2]',
              'xpath=(//business-name-view-for-chat//material-input//input)[2]',
            ]) {
              try {
                urlInput = await page.waitForSelector(sel, { visible: true, timeout: 4000 });
                if (urlInput) break;
              } catch { /* próximo */ }
            }
            if (urlInput) {
              await urlInput.click({ clickCount: 3 });
              await sleep(300);
              await urlInput.type('www.youtube.com.br', { delay: TIMINGS.typingDelay });
              log('  ✅ URL preenchida');
            }
          } catch (e) { log(`  ⚠️ Erro URL: ${e.message}`); }
          await sleep(randomDelay(1500, 3000));
          await clickFirst(page, [
            'xpath=//business-name-wrapper//button-panel//material-button[1]/material-ripple',
            'xpath=//business-name-view-for-chat//button-panel//material-button/material-ripple',
          ], 'Avançar URL', log, 10000);
          await sleep(randomDelay(4000, 6000));
        }
        else if (currentStage === 'business-insights') {
          log('  → Avançando business-insights...');
          await clickFirst(page, [
            'xpath=//business-insights-wrapper//button-panel//material-button[1]/material-ripple',
            'xpath=//business-insights-wrapper//button-panel//material-button/material-ripple',
          ], 'Avançar insights', log, 10000);
          await sleep(randomDelay(4000, 6000));
        }
        else if (currentStage === 'linking') {
          log('  → Pulando linking...');
          await clickFirst(page, [
            'xpath=//linking-wrapper//button-panel//material-button[3]/material-ripple',
            'xpath=//linking-wrapper//button-panel//material-button[2]/material-ripple',
            'xpath=//linking-wrapper//button-panel//material-button:last-of-type/material-ripple',
          ], 'Pular linking', log, 10000);
          await sleep(randomDelay(4000, 6000));
        }
        else if (currentStage === 'campaign-goals') {
          log('  → Pulando campaign-goals...');
          await clickFirst(page, [
            'xpath=//campaign-goals-wrapper//button-panel//material-button[3]/material-ripple',
            'xpath=//campaign-goals-wrapper//button-panel//material-button[2]/material-ripple',
            'xpath=//campaign-goals-wrapper//button-panel//material-button:last-of-type/material-ripple',
          ], 'Pular campaign-goals', log, 10000);
          await sleep(randomDelay(4000, 6000));
        }
        else if (currentStage === 'campaign-type') {
          log('  → Pulando campaign-type...');
          await clickFirst(page, [
            'xpath=//campaign-type-wrapper//button-panel//material-button[3]/material-ripple',
            'xpath=//campaign-type-wrapper//button-panel//material-button[2]/material-ripple',
            'xpath=//campaign-type-wrapper//button-panel//material-button:last-of-type/material-ripple',
            'xpath=//campaign-subtype-wrapper//button-panel//material-button[3]/material-ripple',
            'xpath=//campaign-subtype-wrapper//button-panel//material-button[2]/material-ripple',
          ], 'Pular campaign-type', log, 10000);
          await sleep(randomDelay(4000, 6000));
        }
        else if (currentStage === 'expert') {
          log('  ✅ expert-wrapper — selecionando USD e continuando...');
          // Seleciona USD
          await clickFirst(page, [
            'xpath=//*[contains(@id,"aED1B6733")]',
            'xpath=//*[contains(@id,"a1535AF3A")]',
            'material-dropdown-select',
            'xpath=//material-dropdown-select//dropdown-button',
          ], 'Seletor moeda', log, 10000);
          await sleep(randomDelay(2000, 3000));
          await clickFirst(page, [
            'material-select-item:has-text("USD")',
            '[role="option"]:has-text("USD")',
            ':text("USD")',
          ], 'USD', log, 10000);
          await sleep(randomDelay(2000, 3000));
          // Clica Continuar → leva para signup/payment
          const continuarOk = await clickFirst(page, [
            'xpath=//expert-wrapper/div/div/material-button[1]/material-ripple',
            'xpath=//expert-wrapper//material-button[1]/material-ripple',
            'xpath=//expert-wrapper//material-button/material-ripple',
            'xpath=//expert-wrapper//material-button[1]',
            'xpath=//expert-wrapper//material-button',
          ], 'Continuar', log, 10000);
          if (!continuarOk) {
            // Fallback: clica por texto "continuar" ou último botão visível da página
            await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('material-button, button'))
                .filter(b => b.offsetParent !== null);
              const cont = btns.find(b => /continuar|continue|salvar|save/i.test(b.textContent || ''));
              if (cont) { cont.click(); return; }
              // fallback: último botão primário visível
              const primary = btns.filter(b => {
                const cls = b.className || '';
                return /raised|primary|submit/i.test(cls);
              });
              if (primary.length) primary[primary.length - 1].click();
              else if (btns.length) btns[btns.length - 1].click();
            });
            log('  ⚠️ Continuar via fallback evaluate');
          }
          await sleep(randomDelay(5000, 8000));
        }
        else {
          // Etapa desconhecida — tenta pular
          log(`  ⚠️ Etapa desconhecida — tentando pular...`);
          await sleep(randomDelay(2000, 3000));
          const skipped = await clickFirst(page, [
            'xpath=//button-panel//material-button[3]/material-ripple',
            'xpath=//button-panel//material-button[2]/material-ripple',
            'xpath=//button-panel//material-button:last-of-type/material-ripple',
          ], 'Pular etapa', log, 8000);
          if (skipped) {
            await sleep(randomDelay(4000, 6000));
          } else {
            await sleep(randomDelay(2000, 3000));
          }
        }
      }

      // Pós-loop: se expert-wrapper não foi detectado mas dialog apareceu
      // (acontece quando wizard vai direto para dialog sem passar por expert)
      try {
        const dialogConfirmed = await page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll('material-dialog'));
          for (const dialog of dialogs) {
            const style = window.getComputedStyle(dialog);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const btn = dialog.querySelector('material-yes-no-buttons material-button:first-of-type');
            if (btn) { btn.click(); return true; }
          }
          return false;
        });
        if (dialogConfirmed) {
          log('  ✅ Dialog pós-wizard confirmado');
          await sleep(randomDelay(4000, 6000));
        }
      } catch { /* ignora */ }
    }

    log('✅ [2/5] Campanha/wizard concluído');
  } catch (err) {
    log(`⚠️ Erro na Parte 2: ${err.message}`);
  }

  // ── Parte 3: Configurar perfil de pagamento + cartão ─────
  log('🔷 [3/5] Configurando pagamento...');
  try {
    // NÃO navegamos para aw/billing — o botão "Criar novo perfil" só existe
    // na tela de signup/payment onde o wizard nos deixou.
    // Se por algum motivo não estamos lá, logamos mas não navegamos para lugar errado.
    const urlPart3 = page.url();
    log(`  📍 URL Part 3: ${urlPart3}`);

    const card = getNextCard();
    if (!card) {
      log('❌ Nenhum cartão disponível em cards.json');
    } else {
      log(`  Usando cartão: ${card.numero_cartao.slice(0, 9)}...`);

      // === HELPER: Encontra input visível por ID ou fallback ===
      async function findVisibleInput(ids, fallbackSelectors = [], context = page) {
        for (const id of ids) {
          try {
            const el = await context.$(`xpath=//*[@id="${id}"]`);
            if (el && await el.isVisible()) return el;
          } catch { /* próximo */ }
        }
        for (const sel of fallbackSelectors) {
          try {
            const el = await context.$(sel);
            if (el && await el.isVisible()) return el;
          } catch { /* próximo */ }
        }
        return null;
      }

      // === OBTÉM O FRAME DO IFRAME DE PAGAMENTO ===
      // Todo o conteúdo de "Criar novo perfil" está dentro do iframe #payments-signup-iframe-containerIframe
      let frame = null;
      for (let attempt = 1; attempt <= 2 && !frame; attempt++) {
        try {
          const iframeEl = await page.waitForSelector(
            '#payments-signup-iframe-containerIframe',
            { state: 'attached', timeout: 12000 }
          ).catch(() => null);

          if (iframeEl) {
            const contentFrame = await iframeEl.contentFrame();
            if (contentFrame) {
              frame = contentFrame;
              log('  ✅ Frame do iframe de pagamento obtido');
              break;
            }
          }

          if (attempt === 1) {
            log('  ⚠️ Iframe de pagamento não apareceu — tentando reabrir signup...');
            await page.goto('https://ads.google.com/aw/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(randomDelay(4000, 6000));
          }
        } catch (e) {
          log(`  ⚠️ Tentativa ${attempt} para obter iframe falhou: ${e.message}`);
        }
      }

      if (!frame) {
        throw new Error('Iframe de pagamento não encontrado — fluxo não está na tela correta');
      }

      // Helper genérico: busca um seletor CSS em todos os frames e clica
      async function clickInAnyFrame(cssSelector, timeoutMs = 8000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const f of page.frames()) {
            try {
              const clicked = await f.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
                return false;
              }, cssSelector);
              if (clicked) return true;
            } catch { /* próximo frame */ }
          }
          await sleep(400);
        }
        return false;
      }

      // ── PASSO 1: Criar perfil de pagamento ──
      // Dupla validação: flag na conta OU nome da org visível no iframe
      let profileAlreadyExists = !!account.paymentProfileCreated;
      if (!profileAlreadyExists) {
        try {
          const iframeText = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
          if (ORG_NAMES.some(name => iframeText.includes(name))) {
            log('  ℹ️ Nome da organização detectado no iframe — perfil já existe');
            profileAlreadyExists = true;
          }
        } catch { }
      }

      /** Busca em todos os frames por inputs c{N} visíveis — retorna { formFrame, minId, maxId } */
      async function findFormFrame(timeoutMs = 10000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const f of page.frames()) {
            try {
              const result = await f.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[id]'))
                  .filter(i => /^c\d+$/.test(i.id) && i.offsetParent !== null);
                if (inputs.length < 1) return null;
                const nums = inputs.map(i => parseInt(i.id.slice(1), 10)).sort((a, b) => a - b);
                return { minId: nums[0], maxId: nums[nums.length - 1], count: nums.length };
              });
              if (result) {
                log(`  🔍 Frame encontrado: ${f.url().substring(0, 80)} (inputs c${result.minId}…c${result.maxId})`);
                return { formFrame: f, ...result };
              }
            } catch { }
          }
          await sleep(300);
        }
        return null;
      }

      /** Preenche input pelo ID no frame específico */
      async function fillInputById(f, id, value) {
        return f.evaluate(({ id, value }) => {
          const el = document.getElementById(id);
          if (!el) return false;
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, { id, value });
      }

      if (profileAlreadyExists) {
        log('  ℹ️ Perfil de pagamento já criado — pulando para forma de pagamento');
      } else {
        log('  → Procurando botão "Criar novo perfil para pagamentos"...');
        let profileBtnClicked = false;

        // 1) Por texto em todos os frames
        for (const f of page.frames()) {
          try {
            const clicked = await f.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, [role="button"], a'))
                .filter(b => b.offsetParent !== null);
              for (const btn of btns) {
                if (/criar.*perfil.*pagamentos|create.*payment.*profile/i.test(btn.textContent || '')) {
                  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  return (btn.textContent || '').trim();
                }
              }
              return null;
            });
            if (clicked) {
              log(`  ✅ "Criar novo perfil" clicado: "${clicked}"`);
              profileBtnClicked = true;
              break;
            }
          } catch { }
        }

        // 2) Fallback: loop id-1..30
        if (!profileBtnClicked) {
          log('  ⚠️ Botão por texto não encontrado — tentando id-1..30...');
          for (let idNum = 1; idNum <= 30 && !profileBtnClicked; idNum++) {
            const sel = `#id-${idNum}`;
            const exists = await frame.$(sel).catch(() => null);
            if (!exists) continue;
            await frame.evaluate((selector) => {
              const el = document.querySelector(selector);
              if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }, sel);
            await sleep(randomDelay(800, 1200));
            const formAppeared = await frame.evaluate(() =>
              Array.from(document.querySelectorAll('input')).filter(i => i.offsetParent !== null).length >= 2
            ).catch(() => false);
            if (formAppeared) {
              log(`  ✅ Formulário apareceu após clicar ${sel}`);
              profileBtnClicked = true;
            }
          }
          if (!profileBtnClicked) log('  ⚠️ "Criar novo perfil" não encontrado — tentando preencher mesmo assim');
        }
        await sleep(randomDelay(1500, 2500));

        // Preenche org name + CEP
        const orgName = getRandomOrgName();
        const zipCode = getRandomZip();
        const formResult = await findFormFrame(10000);

        if (formResult) {
          const { formFrame, minId, maxId } = formResult;

          log(`  📋 Preenchendo Nome da organização (#c${minId}): "${orgName}"...`);
          try {
            const ok = await fillInputById(formFrame, `c${minId}`, orgName);
            log(ok ? '  ✅ Nome da organização preenchido' : `  ⚠️ #c${minId} não encontrado`);
            await sleep(randomDelay(600, 1200));
          } catch (e) { log(`  ⚠️ Erro nome organização: ${e.message}`); }

          log(`  📮 Preenchendo CEP (#c${maxId}): "${zipCode}"...`);
          try {
            const ok = await fillInputById(formFrame, `c${maxId}`, zipCode);
            log(ok ? '  ✅ CEP preenchido' : `  ⚠️ #c${maxId} não encontrado`);
            await sleep(randomDelay(600, 1200));
          } catch (e) { log(`  ⚠️ Erro CEP: ${e.message}`); }

          // Clica "Criar" no frame do formulário
          log('  → Clicando "Criar"...');
          try {
            const clicked = await formFrame.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
              for (const btn of btns) {
                if (/^criar$|^create$/i.test((btn.textContent || '').trim())) { btn.click(); return btn.textContent.trim(); }
              }
              if (btns.length) { btns[btns.length - 1].click(); return 'último botão'; }
              return null;
            });
            if (clicked) log(`  ✅ "Criar" clicado: "${clicked}"`);
            else log('  ⚠️ Botão "Criar" não encontrado');
          } catch (e) { log(`  ⚠️ Erro ao clicar Criar: ${e.message}`); }
        } else {
          log('  ⚠️ Frame do formulário não encontrado — tentando clicar "Criar" em qualquer frame...');
          for (const f of page.frames()) {
            try {
              const clicked = await f.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
                if (btns.length) { btns[btns.length - 1].click(); return 'último botão'; }
                return null;
              });
              if (clicked) { log('  ✅ Fallback "Criar" clicado'); break; }
            } catch { }
          }
        }
        await sleep(randomDelay(3000, 5000));

        // Salva status na conta
        try {
          if (account.id) updateAccount(account.id, { paymentProfileCreated: true });
          log('  ✅ Status "perfil de pagamento adicionado" salvo na conta');
        } catch (e) { log(`  ⚠️ Erro ao salvar status: ${e.message}`); }
      }

      // ── PASSO 2: Clicar em "Adicionar forma de pagamento" ──
      log('  → Procurando "Adicionar forma de pagamento"...');
      let paymentMethodClicked = false;
      await sleep(randomDelay(1500, 2500));

      // 1) Por texto em todos os frames
      for (const f of page.frames()) {
        try {
          const clicked = await f.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, [role="button"], a'))
              .filter(b => b.offsetParent !== null);
            for (const btn of btns) {
              if (/adicionar forma de pagamento|add payment method/i.test(btn.textContent || '')) {
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return (btn.textContent || '').trim();
              }
            }
            return null;
          });
          if (clicked) {
            log(`  ✅ "Adicionar forma de pagamento" clicado por texto: "${clicked}"`);
            paymentMethodClicked = true;
            break;
          }
        } catch { }
      }

      // 2) Loop id-100..300
      if (!paymentMethodClicked) {
        log('  ⚠️ Botão por texto não encontrado — tentando ids 100..300...');
        for (let idNum = 100; idNum <= 300 && !paymentMethodClicked; idNum++) {
          const visible = await frame.evaluate((s) => {
            const el = document.querySelector(s);
            return el && el.offsetParent !== null;
          }, `#id-${idNum}`).catch(() => false);
          if (!visible) continue;
          await frame.evaluate((s) => {
            const el = document.querySelector(s);
            if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }, `#id-${idNum}`);
          await sleep(randomDelay(1000, 1500));
          // Verifica se abriu modal (botão "+" ou texto de cartão)
          const modalOpened = await (async () => {
            for (const f of page.frames()) {
              try {
                const has = await f.evaluate(() =>
                  Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null)
                    .some(b => b.textContent?.trim() === '+' || /cart[aã]o de cr[eé]dito/i.test(b.textContent || ''))
                );
                if (has) return true;
              } catch { }
            }
            return false;
          })();
          if (modalOpened) {
            log(`  ✅ Modal de pagamento aberta após id-${idNum}`);
            paymentMethodClicked = true;
          }
        }
      }

      // 3) Último recurso: id-1..99
      if (!paymentMethodClicked) {
        log('  ⚠️ Tentando ids 1..99 (último recurso)...');
        for (let idNum = 1; idNum <= 99 && !paymentMethodClicked; idNum++) {
          const visible = await frame.evaluate((s) => {
            const el = document.querySelector(s);
            return el && el.offsetParent !== null;
          }, `#id-${idNum}`).catch(() => false);
          if (!visible) continue;
          await frame.evaluate((s) => {
            const el = document.querySelector(s);
            if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }, `#id-${idNum}`);
          await sleep(randomDelay(800, 1200));
          paymentMethodClicked = true;
        }
        if (!paymentMethodClicked) log('  ⚠️ Nenhum id encontrado para "Adicionar forma de pagamento"');
      }
      await sleep(randomDelay(2000, 3000));

      // ── PASSO 3: Clicar no primeiro "+" — "Adicionar cartão de crédito ou débito" ──
      log('  → Clicando "Adicionar cartão de crédito ou débito"...');
      let addCardClicked = false;

      // 1) Por texto em todos os frames
      for (const f of page.frames()) {
        try {
          const clicked = await f.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
              .filter(b => b.offsetParent !== null);
            for (const btn of btns) {
              if (/adicionar cart[aã]o de cr[eé]dito|add credit.*debit/i.test(btn.textContent || '')) {
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return (btn.textContent || '').trim().substring(0, 60);
              }
            }
            // Primeiro "+" visível
            const plusBtn = btns.find(b => b.textContent?.trim() === '+');
            if (plusBtn) {
              plusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return '+';
            }
            return null;
          });
          if (clicked) {
            log(`  ✅ "Adicionar cartão" clicado: "${clicked}"`);
            addCardClicked = true;
            break;
          }
        } catch { }
      }

      // 2) Fallback: loop id-100..300 em todos os frames
      if (!addCardClicked) {
        log('  ⚠️ Botão por texto não encontrado — tentando id-100..300 em todos os frames...');
        outer: for (let idNum = 100; idNum <= 300 && !addCardClicked; idNum++) {
          for (const f of page.frames()) {
            try {
              const found = await f.evaluate((s) => {
                const el = document.querySelector(s);
                return el && el.offsetParent !== null;
              }, `#id-${idNum}`);
              if (!found) continue;
              await f.evaluate((s) => {
                const el = document.querySelector(s);
                if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }, `#id-${idNum}`);
              // Aguarda e valida se o modal de cartão abriu (#c1 apareceu)
              await sleep(randomDelay(800, 1200));
              let c1appeared = false;
              for (const f2 of page.frames()) {
                try {
                  const has = await f2.evaluate(() => !!document.getElementById('c1'));
                  if (has) { c1appeared = true; break; }
                } catch { }
              }
              if (c1appeared) {
                log(`  ✅ Modal de cartão aberta após id-${idNum} (frame: ${f.url().substring(0, 60)})`);
                addCardClicked = true;
                break outer;
              }
            } catch { }
          }
        }
        if (!addCardClicked) log('  ⚠️ Nenhum botão de adicionar cartão encontrado');
      }
      await sleep(addCardClicked ? randomDelay(1500, 2500) : 0);

      // ── PASSO 4: Preencher dados do cartão no _modalIframe (c1, c6, c11) ──
      if (!addCardClicked) {
        log('  ⚠️ Pulando preenchimento do cartão pois modal não foi aberta');
      } else {
      log('  💳 Preenchendo dados do cartão...');

      async function fillCardData() {
        // Aguarda frame com #c1
        let cardFrame = null;
        const dlCard = Date.now() + 10000;
        while (Date.now() < dlCard) {
          for (const f of page.frames()) {
            try {
              const has = await f.evaluate(() => !!document.getElementById('c1'));
              if (has) { cardFrame = f; break; }
            } catch { }
          }
          if (cardFrame) break;
          await sleep(300);
        }
        if (!cardFrame) return false;

        const cardNum = card.numero_cartao.replace(/\s/g, '');
        const [mo, yr] = card.validade.split('/');
        const cvc = card.cvc;

        const ok1 = await fillInputById(cardFrame, 'c1', cardNum);
        log(ok1 ? '  ✅ #c1 (número) preenchido' : '  ⚠️ #c1 não encontrado');
        await sleep(randomDelay(600, 1200));

        const ok6 = await fillInputById(cardFrame, 'c6', `${mo}/${yr}`);
        log(ok6 ? '  ✅ #c6 (validade) preenchido' : '  ⚠️ #c6 não encontrado');
        await sleep(randomDelay(600, 1200));

        const ok11 = await fillInputById(cardFrame, 'c11', cvc);
        log(ok11 ? '  ✅ #c11 (CVC) preenchido' : '  ⚠️ #c11 não encontrado');
        await sleep(randomDelay(1000, 2000));

        // Clica no último botão visível do frame (salvar cartão)
        const saved = await cardFrame.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
          if (!btns.length) return null;
          btns[btns.length - 1].click();
          return btns[btns.length - 1].textContent?.trim() || 'último botão';
        });
        log(saved ? `  ✅ Cartão salvo (botão: "${saved}")` : '  ⚠️ Nenhum botão salvar encontrado');
        return !!saved;
      }

      let cardSaved = await fillCardData().catch(e => { log(`  ⚠️ Erro ao preencher cartão: ${e.message}`); return false; });

      // Fallback: refresh + reabrir modal
      if (!cardSaved) {
        log('  ⚠️ Campos do cartão não encontrados — recarregando e tentando novamente...');
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(randomDelay(5000, 8000));
          // Tenta reabrir modal de adicionar cartão
          for (const f of page.frames()) {
            try {
              const clicked = await f.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
                  .filter(b => b.offsetParent !== null);
                for (const btn of btns) {
                  const txt = (btn.textContent || '').trim();
                  if (/adicionar cart[aã]o|add.*card/i.test(txt) || txt === '+') {
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return txt;
                  }
                }
                return null;
              });
              if (clicked) { log(`  ✅ Modal reaberta após refresh: "${clicked}"`); break; }
            } catch { }
          }
          await sleep(randomDelay(2000, 3000));
          cardSaved = await fillCardData().catch(() => false);
          log(cardSaved ? '  ✅ Cartão salvo após refresh' : '  ⚠️ Cartão não salvo mesmo após refresh');
        } catch (e) { log(`  ⚠️ Erro no refresh fallback: ${e.message}`); }
      }
      } // fim if (addCardClicked)

    }

    // ── PASSO 5: Selecionar "Não" e clicar em Enviar ──
    await sleep(randomDelay(1500, 2500));
    log('  → Selecionando opção "Não"...');
    try {
      // Estratégia 1: input dentro do segundo material-radio de communications-opt-in
      const naoClicked = await page.evaluate(() => {
        const radios = document.querySelectorAll('communications-opt-in material-radio');
        if (radios.length >= 2) {
          const input = radios[1].querySelector('input');
          if (input) {
            input.click();
            // Dispara eventos para garantir que o framework Angular detecta a mudança
            input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          // fallback: clica no próprio material-radio[2]
          radios[1].click();
          return true;
        }
        return false;
      });
      if (naoClicked) {
        log('  ✅ Opção "Não" selecionada (material-radio[2])');
      } else {
        // Estratégia 2: pelo ID parcial original
        await page.evaluate(() => {
          const el = document.querySelector('[id*="a71E94930"]');
          if (el) el.click();
        });
        log('  ✅ Opção "Não" selecionada (id fallback)');
      }
    } catch (e2) { log(`  ⚠️ Opção "Não" não encontrada: ${e2.message}`); }

    log('  ⏳ Aguardando 30 segundos antes de clicar em Enviar...');
    await sleep(30000);
    log('  → Clicando em "Enviar"...');
    try {
      // Tenta pelo CSS do botão Enviar (payments-signup div[4] material-button[1])
      const submitClicked = await page.evaluate(() => {
        const sel = 'payments-signup material-button';
        const btns = Array.from(document.querySelectorAll(sel)).filter(b => b.offsetParent !== null);
        if (btns.length) { btns[0].click(); return (btns[0].textContent || '').trim().substring(0, 40); }
        // fallback: qualquer botão visível com texto "enviar" ou "submit"
        const allBtns = Array.from(document.querySelectorAll('button, material-button'))
          .filter(b => b.offsetParent !== null && /enviar|submit/i.test(b.textContent || ''));
        if (allBtns.length) { allBtns[0].click(); return (allBtns[0].textContent || '').trim().substring(0, 40); }
        return null;
      });
      if (submitClicked) {
        log(`  ✅ Botão "Enviar" clicado: "${submitClicked}"`);
      } else {
        // fallback XPath
        const submitEl = await page.$x('//*[@id="dart-1778795673777"]//material-button[1]').catch(() => []);
        if (submitEl.length) { await submitEl[0].click(); log('  ✅ Botão "Enviar" clicado (XPath)'); }
        else { log('  ⚠️ Botão "Enviar" não encontrado'); }
      }
    } catch (e) { log(`  ⚠️ Erro ao clicar "Enviar": ${e.message}`); }

    // ── Captura o ID da conta Google Ads após clicar em Enviar ──
    await sleep(randomDelay(1500, 2500));
    try {
      const adsUrl = page.url();
      log(`📍 URL pós-enviar: ${adsUrl}`);
      let urlIdMatch = adsUrl.match(/(?:ocid|customerId)=(\d+)/);
      if (urlIdMatch) googleAdsAccountId = urlIdMatch[1];
      if (!googleAdsAccountId) {
        const htmlContent = await page.content();
        const idMatch = htmlContent.match(/\b(\d{3}[-\s]?\d{3}[-\s]?\d{4})\b/);
        if (idMatch) googleAdsAccountId = idMatch[1].replace(/[-\s]/g, '');
      }
      if (googleAdsAccountId) log(`✅ Google Ads Account ID: ${googleAdsAccountId}`);
      else log('⚠️ ID da conta não encontrado — será null');
    } catch (err) { log(`⚠️ Erro ao capturar ID: ${err.message}`); }

    // ── PASSO 6: Aguardar tela "Sua conta foi criada" e clicar em Continuar ──
    log('  ⏳ Aguardando tela "Sua conta foi criada"...');
    try {
      await page.waitForFunction(
        () => /sua conta foi criada|account.*created/i.test(document.body?.innerText || ''),
        { timeout: 30000 }
      );
      log('  ✅ Tela "Sua conta foi criada" detectada');
    } catch {
      log('  ⚠️ Tela "Sua conta foi criada" não detectada — tentando continuar');
    }
    await sleep(randomDelay(1500, 2500));

    log('  → Clicando em "Continuar"...');
    try {
      const continuarClicked = await page.evaluate(() => {
        // Botão em onboarding-congrats-view identity-verification-entry div[3]
        const sel = 'onboarding-congrats-view identity-verification-entry material-button';
        const btns = Array.from(document.querySelectorAll(sel)).filter(b => b.offsetParent !== null);
        if (btns.length) { btns[0].click(); return (btns[0].textContent || '').trim().substring(0, 40); }
        // fallback: qualquer botão visível com texto "continuar/continue"
        const allBtns = Array.from(document.querySelectorAll('material-button, button'))
          .filter(b => b.offsetParent !== null && /continuar|continue/i.test(b.textContent || ''));
        if (allBtns.length) { allBtns[0].click(); return (allBtns[0].textContent || '').trim().substring(0, 40); }
        return null;
      });
      if (continuarClicked) {
        log(`  ✅ "Continuar" clicado: "${continuarClicked}"`);
      } else {
        log('  ⚠️ Botão "Continuar" não encontrado');
      }
    } catch (e) { log(`  ⚠️ Erro ao clicar "Continuar": ${e.message}`); }

    await sleep(randomDelay(2000, 3000));

    // ── PASSO 7: Selecionar primeira opção (material-radio[1]) em questions-widget div[3] ──
    log('  → Selecionando opção no questionário (div[3] material-radio[1])...');
    try {
      const r1Clicked = await page.evaluate(() => {
        const groups = document.querySelectorAll('questions-widget > div > div');
        // div[3] = index 2
        const div3 = groups[2];
        if (div3) {
          const radios = div3.querySelectorAll('material-radio');
          if (radios.length) {
            const input = radios[0].querySelector('input');
            if (input) {
              input.click();
              input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            radios[0].click();
            return true;
          }
        }
        return false;
      });
      log(r1Clicked ? '  ✅ Opção do questionário selecionada' : '  ⚠️ Opção do questionário não encontrada');
    } catch (e) { log(`  ⚠️ Erro ao selecionar opção: ${e.message}`); }

    await sleep(randomDelay(1500, 2500));

    // ── PASSO 8: Clicar no material-button em questions-widget div[4] para finalizar ──
    log('  → Clicando no botão final (questions-widget div[4])...');
    try {
      const finalClicked = await page.evaluate(() => {
        const groups = document.querySelectorAll('questions-widget > div > div');
        // div[4] = index 3
        const div4 = groups[3];
        if (div4) {
          const btn = div4.querySelector('material-button');
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return (btn.textContent || '').trim().substring(0, 40);
          }
        }
        return null;
      });
      if (finalClicked) {
        log(`  ✅ Botão final clicado: "${finalClicked}"`);
      } else {
        log('  ⚠️ Botão final não encontrado');
      }
    } catch (e) { log(`  ⚠️ Erro ao clicar botão final: ${e.message}`); }

    await sleep(randomDelay(2000, 3000));

    log('✅ [3/5] Pagamento configurado');
    log('⏳ Aguardando 5 minutos com o navegador aberto para análise...');
    await sleep(300000);
    log('✅ Pausa de 5 minutos concluída — prosseguindo...');
  } catch (err) {
    log(`⚠️ Erro na Parte 3 (Pagamento): ${err.message}`);
  }

  // Aguarda 2 minutos antes de ir ao Google Cloud
  if (account.googleAdsApiKey) {
    log('⏭️ API Key já existe — pulando Partes 4 e 5 (Cloud Console + API Key)');
    return { apiKey: account.googleAdsApiKey, googleAdsAccountId };
  }

  log('⏳ Aguardando 2 minutos antes de ir ao Google Cloud...');
  await sleep(120000);

  // ── Parte 4: Cloud Console — criar projeto (se necessário) ─
  log('🔷 [4/5] Cloud Console — Credenciais...');
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

        // Clica no botão de confirmar da modal (depois do checkbox)
        await clickFirst(page, [
          'xpath=//*[@id="mat-mdc-dialog-0"]/div/div/xap-deferred-loader-outlet/ng-component/mat-dialog-actions/cfc-progress-button/div[1]/button',
          'mat-dialog-actions cfc-progress-button button',
          'mat-dialog-actions button',
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

    log('✅ [4/5] Concluída');
  } catch (err) {
    log(`⚠️ Erro na Parte 4: ${err.message}`);
  }

  // ── Parte 5: Criar chave de API ──────────────────────────
  log('🔷 [5/5] Criando chave de API...');
  try {
    // Garante que está na página de credenciais
    const urlNow = page.url();
    log(`📍 URL: ${urlNow}`);
    
    if (!urlNow.includes('apis/credentials')) {
      log('  Navegando para credenciais...');
      await page.goto('https://console.cloud.google.com/apis/credentials', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(randomDelay(6000, 9000));
    }

    // Aguarda a página carregar completamente
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await sleep(randomDelay(2000, 4000));

    // Passo 1: "Criar credenciais"
    log('  Passo 1: Criar credenciais...');
    const credsClicked = await clickFirst(page, [
      '[id$="action-bar-create-button"]',
      'xpath=//*[contains(@id, "action-bar-create-button")]',
      'button:has-text("Criar credenciais")',
      'button:has-text("Create credentials")',
      'button:has-text("CREATE CREDENTIALS")',
    ], 'Criar credenciais', log, 20000);

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
      '[role="menuitem"]:has-text("Chave de API")',
      '[role="menuitem"]:has-text("API key")',
      'a:has-text("Chave de API")',
      'a:has-text("API key")',
    ], 'Chave de API', log, 10000);

    if (!apiKeyClicked) {
      log('❌ Abortando — sem opção "Chave de API"');
      return { apiKey: null, googleAdsAccountId };
    }
    
    // Aguarda modal de criação da chave aparecer (pode demorar)
    log('  Aguardando modal de criação da chave...');
    await sleep(randomDelay(5000, 8000));
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}

    // Passo 3: Tipo de restrição (primeiro select) — OPCIONAL, pode não aparecer
    log('  Passo 3: Select restrição (se existir)...');
    const select1 = await clickFirst(page, [
      'cfc-select > div',
      '[id$="cfc-select-1"] > div',
      'xpath=//*[contains(@id, "cfc-select")]/div',
    ], 'Select 1', log, 5000);

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
      ], 'OK select', log, 8000);
      await sleep(randomDelay(2000, 4000));
    } else {
      log('  ℹ️ Sem select de restrição — pode ser criação direta');
    }

    // Passo 6: Criar chave (botão final — pode já ter sido criada automaticamente)
    log('  Passo 6: Botão criar chave...');
    await clickFirst(page, [
      'apis-create-api-key-subtask cfc-progress-button button',
      'cfc-progress-button button:has-text("Criar")',
      'cfc-progress-button button:has-text("Create")',
      'button:has-text("Criar chave")',
      'button:has-text("Create key")',
    ], 'Criar chave', log, 8000);
    
    // Aguarda criação da chave (pode demorar bastante)
    log('  Aguardando geração da chave...');
    await sleep(randomDelay(6000, 10000));
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await sleep(randomDelay(2000, 4000));

    // Passo 7: Capturar a chave (múltiplas estratégias com retry)
    log('  Passo 7: Capturando chave...');

    // Retry loop — a chave pode demorar a aparecer no DOM
    for (let attempt = 1; attempt <= 3 && !apiKey; attempt++) {
      if (attempt > 1) {
        log(`  🔄 Tentativa ${attempt}/3 de capturar a chave...`);
        await sleep(randomDelay(3000, 5000));
      }

      // mat-form-field input
      try {
        const matInput = await page.$('apis-create-api-key-subtask mat-form-field input');
        if (matInput) {
          apiKey = await matInput.inputValue();
          if (apiKey && apiKey.startsWith('AIza')) {
            log(`  ✓ Chave de mat-form-field input: ${apiKey.slice(0, 15)}...`);
            break;
          }
          apiKey = null;
        }
      } catch {}

      // mat-form-field textarea
      if (!apiKey) {
        try {
          const matTa = await page.$('apis-create-api-key-subtask mat-form-field textarea');
          if (matTa) {
            const val = await matTa.evaluate(el => el.value);
            if (val && val.startsWith('AIza')) {
              apiKey = val;
              log(`  ✓ Chave de mat-form-field textarea: ${apiKey.slice(0, 15)}...`);
              break;
            }
          }
        } catch {}
      }

      // Qualquer input com AIza
      if (!apiKey) {
        try {
          const inputs = await page.$$('input[type="text"], textarea, input[readonly], input');
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

      // Regex no HTML — busca mais ampla
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
    } // fim do retry loop

    if (apiKey) {
      apiKey = apiKey.trim();
      log(`✅ API Key: ${apiKey.slice(0, 10)}...`);
    } else {
      log('❌ Não foi possível capturar a chave');
    }
  } catch (err) {
    log(`⚠️ Erro na Parte 5: ${err.message}`);
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
export async function runWarmupSession(account, log = console.log, dayNumber = 1, timeoutMs = TIMINGS.warmupSessionMinutes * 60 * 1000) {
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

  const launchOpts = buildLaunchOpts(proxyForBrowser);

  let context = null;
  let timedOut = false;
  let timeoutId = null;

  try {
    log(`Iniciando browser para ${account.email}`);
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await applyStealthScripts(context);
    await sleep(TIMINGS.browserStartupWait);

    // Timeout interno: força o fechamento do browser para evitar travamento
    timeoutId = setTimeout(() => {
      timedOut = true;
      log(`⏱️ Timeout de ${Math.round(timeoutMs / 60000)} min! Forçando fechamento do browser...`);
      if (context) context.close().catch(() => {});
    }, timeoutMs);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);

    // 1. Login
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail, account.totpSecret || '');

    // 1a. Trocar idioma para Português do Brasil (apenas no dia 1)
    if (dayNumber === 1) {
      await changeLanguageToPortuguese(page, log);
    }

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
      const adsResult = await createGoogleAdsAccount(page, log, account);
      googleAdsApiKey = adsResult.apiKey;
      googleAdsAccountId = adsResult.googleAdsAccountId;
    }

    // Salva cookies do perfil para exportação posterior
    try {
      const cookies = await context.cookies();
      const cookiesPath = join(profilePath, 'cookies.json');
      writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      log(`✓ Cookies salvos (${cookies.length} cookies)`);
    } catch (e) {
      log(`⚠️ Não foi possível salvar cookies: ${e.message}`);
    }

    log(`Sessão de aquecimento concluída para ${account.email}`);
    return { success: true, googleAdsApiKey, googleAdsAccountId };

  } catch (err) {
    if (timedOut) {
      log(`⏱️ ${account.email}: Timeout — sessão forçadamente encerrada`);
      return { success: false, error: 'Timeout: sessão travada' };
    }
    log(`ERRO no aquecimento de ${account.email}: ${err.message}`);
    return { success: false, error: err.message };

  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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

/**
 * Abre apenas o Chrome persistente da conta para testes manuais.
 * Não aplica timeout automático; o encerramento é manual via UI/API.
 */
export async function openChromeForTesting(account, log = console.log) {
  const profilePath = join(PROFILES_DIR, account.id);
  if (!existsSync(profilePath)) mkdirSync(profilePath, { recursive: true });

  const proxyConfig = parseProxy(account.proxy);
  let proxyForBrowser = null;
  let proxyTunnel = null;
  let tunnelClosed = false;

  const closeProxyTunnel = async () => {
    if (!proxyTunnel || tunnelClosed) return;
    tunnelClosed = true;
    try {
      await proxyTunnel.close();
    } catch {
      // ignora fechamento duplicado
    }
  };

  if (proxyConfig) {
    if (proxyConfig.type === 'socks5' && proxyConfig.hasAuth) {
      try {
        log(`Criando tunnel SOCKS5 com autenticação...`);
        proxyTunnel = await createSocksProxyTunnel(
          proxyConfig.host,
          proxyConfig.port,
          proxyConfig.username,
          proxyConfig.password
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

  const launchOpts = buildLaunchOpts(proxyForBrowser);

  let context = null;

  try {
    log(`Abrindo Chrome para ${account.email} (sem timeout para testes)...`);
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await applyStealthScripts(context);
    context.once('close', () => {
      closeProxyTunnel().catch(() => {});
    });

    await sleep(TIMINGS.browserStartupWait);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);

    try {
      await page.goto('https://www.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: 0,
      });
    } catch {
      // página inicial é opcional para o modo de teste
    }

    log(`Chrome aberto para ${account.email}. Feche manualmente quando terminar o teste.`);

    return {
      context,
      close: async () => {
        if (context) {
          try {
            await context.close();
          } catch {
            // ignora
          }
        }
        await closeProxyTunnel();
      },
    };
  } catch (err) {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignora
      }
    }
    await closeProxyTunnel();
    throw err;
  }
}

export async function runGoogleAdsOnly(account, log = console.log, timeoutMs = TIMINGS.warmupSessionMinutes * 60 * 1000) {
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

  const launchOpts = buildLaunchOpts(proxyForBrowser);

  let context = null;
  let timedOut = false;
  let timeoutId = null;

  try {
    log(`Iniciando browser para ${account.email} (Google Ads only)...`);
    context = await chromium.launchPersistentContext(profilePath, launchOpts);
    await applyStealthScripts(context);
    await sleep(TIMINGS.browserStartupWait);

    // Timeout interno: força o fechamento do browser
    timeoutId = setTimeout(() => {
      timedOut = true;
      log(`⏱️ Timeout de ${Math.round(timeoutMs / 60000)} min! Forçando fechamento do browser...`);
      if (context) context.close().catch(() => {});
    }, timeoutMs);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);

    // Login
    await loginGoogle(page, account.email, account.password, log, account.recoveryEmail, account.totpSecret || '');

    // Trocar idioma para Português do Brasil antes de criar Google Ads
    await changeLanguageToPortuguese(page, log);

    // Só o fluxo Google Ads + API Key
    const adsResult = await createGoogleAdsAccount(page, log, account);

    // Salva cookies atualizados
    try {
      const cookies = await context.cookies();
      const cookiesPath = join(profilePath, 'cookies.json');
      writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      log(`✓ Cookies salvos (${cookies.length} cookies)`);
    } catch (e) {
      log(`⚠️ Não foi possível salvar cookies: ${e.message}`);
    }

    return { success: true, googleAdsApiKey: adsResult.apiKey, googleAdsAccountId: adsResult.googleAdsAccountId };
  } catch (err) {
    if (timedOut) {
      log(`⏱️ ${account.email}: Timeout — Google Ads forçadamente encerrado`);
      return { success: false, error: 'Timeout: Google Ads travado' };
    }
    log(`ERRO no fluxo Google Ads de ${account.email}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (context) {
      try { await context.close(); } catch { /* ignora */ }
    }
    if (proxyTunnel) {
      try { await proxyTunnel.close(); } catch { /* ignora */ }
    }
  }
}

/**
 * Cria uma conta Google Ads Manager (MCC) para a conta informada.
 * Reutiliza o mesmo fluxo de runGoogleAdsOnly e devolve { success, mccAccountId }.
 */
export async function runMCCCreation(account, log = console.log) {
  log(`Iniciando criação de MCC para ${account.email}...`);
  const result = await runGoogleAdsOnly(account, log);
  if (result.success) {
    const mccAccountId = result.googleAdsAccountId || result.googleAdsApiKey || null;
    log(`✅ MCC: conta Google Ads criada${mccAccountId ? ` — ID: ${mccAccountId}` : ''}`);
    return { success: true, mccAccountId };
  }
  return { success: false, error: result.error };
}
