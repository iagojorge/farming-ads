/**
 * Script: import-contas-prontas.js
 * 
 * 1. Faz backup do store.json atual + pasta profiles
 * 2. Remove todas as contas atuais do store.json
 * 3. Importa 20 novas contas do arquivo TXT (formato Farming Ads export)
 * 4. Cria pastas de profile com cookies.json (formato Playwright) para cada conta
 * 5. Salva store.json atualizado
 * 
 * USO: node scripts/import-contas-prontas.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const STORE_PATH = join(DATA_DIR, 'store.json');
const PROFILES_DIR = join(DATA_DIR, 'profiles');
const TXT_FILE = 'C:/Users/iagob/Downloads/contas_prontas_2026-05-05 (2).txt';

// ── Utilidades ────────────────────────────────────────────────

function makeId() {
  return `${Date.now()}-${randomBytes(5).toString('hex')}`;
}

/**
 * Converte uma linha no formato Netscape para objeto cookie do Playwright.
 * Formato Netscape: domain \t httpOnly \t path \t secure \t expires \t name \t value
 */
function parseNetscapeCookie(line) {
  if (!line || line.startsWith('#') || line.trim() === '') return null;
  
  // Remove prefixo #HttpOnly_ se presente
  let httpOnly = false;
  if (line.startsWith('#HttpOnly_')) {
    httpOnly = true;
    line = line.slice('#HttpOnly_'.length);
  }
  
  const parts = line.split('\t');
  if (parts.length < 7) return null;
  
  const [domain, _flag, path, secure, expires, name, ...valueParts] = parts;
  const value = valueParts.join('\t'); // valor pode conter tabs (raro)
  
  return {
    name: name.trim(),
    value: value.trim(),
    domain: domain.trim(),
    path: path.trim() || '/',
    expires: parseInt(expires.trim(), 10) || -1,
    httpOnly,
    secure: secure.trim().toUpperCase() === 'TRUE',
    sameSite: 'None',
  };
}

/**
 * Parseia o arquivo TXT exportado pelo Farming Ads.
 * 
 * Formato do arquivo:
 * ════ (cabeçalho do arquivo, ignorado) ════
 * ──────────── (separador de conta) ────────
 * Email:    xxx@gmail.com
 * Senha:    xxx
 * Proxy:    xxx
 * ...
 * ──────────── (separador) ─────────────────
 *
 * # Netscape HTTP Cookie File
 * [linhas de cookie...]
 *
 * ──────────── (próxima conta) ─────────────
 * ...
 * 
 * Retorna array de { email, password, proxy, cookies[] }
 */
function parseTxtFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  
  const accounts = [];
  let current = null;
  let inCookiesSection = false;
  let inMetaSection = false;  // após o 1º separador ─── e antes do 2º
  
  for (const line of lines) {
    // Ignora o cabeçalho global (====)
    if (line.startsWith('=====')) continue;
    
    // Separador de conta (───)
    if (line.startsWith('───')) {
      if (current) {
        if (inMetaSection) {
          // 2º separador: termina os metadados, próximo será cookies
          inMetaSection = false;
        } else {
          // 1º separador de uma nova conta: salva a conta anterior e começa nova
          if (current.email) accounts.push(current);
          current = { email: null, password: null, proxy: null, cookies: [] };
          inMetaSection = true;
          inCookiesSection = false;
        }
      } else {
        // Primeiro separador do arquivo
        current = { email: null, password: null, proxy: null, cookies: [] };
        inMetaSection = true;
      }
      continue;
    }
    
    if (!current) continue;
    
    // Início da seção de cookies
    if (line.trim() === '# Netscape HTTP Cookie File') {
      inCookiesSection = true;
      inMetaSection = false;
      continue;
    }
    
    if (inMetaSection) {
      const emailMatch = line.match(/^Email:\s+(.+)/);
      const senhaMatch = line.match(/^Senha:\s+(.+)/);
      const proxyMatch = line.match(/^Proxy:\s+(.+)/);
      if (emailMatch) current.email = emailMatch[1].trim();
      if (senhaMatch) current.password = senhaMatch[1].trim();
      if (proxyMatch) current.proxy = proxyMatch[1].trim();
    } else if (inCookiesSection) {
      const cookie = parseNetscapeCookie(line);
      if (cookie) current.cookies.push(cookie);
    }
  }
  
  // Salva última conta
  if (current && current.email) accounts.push(current);
  
  return accounts;
}

// ── Main ──────────────────────────────────────────────────────

console.log('=== IMPORT CONTAS PRONTAS ===\n');

// Verifica se o arquivo de entrada existe
if (!existsSync(TXT_FILE)) {
  console.error(`ERRO: Arquivo não encontrado: ${TXT_FILE}`);
  process.exit(1);
}

// 1. Lê o store atual
console.log('Lendo store.json atual...');
const store = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
const contasAntes = store.accounts.length;
console.log(`  ${contasAntes} contas encontradas\n`);

// 2. Cria backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(DATA_DIR, `backup_${timestamp}`);
console.log(`Criando backup em: ${backupDir}`);
mkdirSync(backupDir, { recursive: true });

// Backup do store.json
writeFileSync(join(backupDir, 'store.json'), JSON.stringify(store, null, 2), 'utf-8');
console.log('  ✓ store.json copiado');

// Backup dos profiles: lista apenas os IDs (não copia arquivos pesados do Chromium)
if (existsSync(PROFILES_DIR)) {
  const profileIds = [];
  try {
    const dirs = readdirSync(PROFILES_DIR);
    dirs.forEach(d => profileIds.push(d));
  } catch(e) {}
  writeFileSync(join(backupDir, 'profiles-list.json'), JSON.stringify(profileIds, null, 2), 'utf-8');
  console.log(`  ✓ Lista de ${profileIds.length} profiles salva (profiles não copiados - são dirs Chromium pesados)`);
} else {
  console.log('  (pasta profiles não existe localmente, nada para copiar)');
}
console.log('');

// 3. Parseia o arquivo de novas contas
console.log(`Parseando arquivo: ${TXT_FILE}`);
const newAccounts = parseTxtFile(TXT_FILE);
console.log(`  ✓ ${newAccounts.length} contas encontradas\n`);

if (newAccounts.length === 0) {
  console.error('ERRO: Nenhuma conta encontrada no arquivo TXT!');
  process.exit(1);
}

// 4. Monta novos registros de conta
console.log('Criando registros de contas...');
const now = new Date().toISOString();
const newAccountRecords = newAccounts.map((acc, i) => {
  const id = makeId();
  
  const record = {
    id,
    email: acc.email,
    password: acc.password,
    proxy: acc.proxy,
    recoveryEmail: null,
    status: 'ready_for_ads',
    profileId: null,
    error: null,
    createdAt: now,
    warmupStartDate: now,
    warmupEndDate: now,
    warmupDaysDone: 3,
    lastWarmupAt: now,
    adsCustomerId: null,
    schedulePeriod: null,
    warmupStatus: 'completed',
    warmupStartTime: now,
    warmupProgress: 100,
    warmupCurrentStep: null,
    cnpj: null,
    googleAdsApiKey: null,
    googleAdsAccountId: null,
  };
  
  // Cria pasta de profile com cookies.json
  if (acc.cookies.length > 0) {
    const profileDir = join(PROFILES_DIR, id);
    mkdirSync(profileDir, { recursive: true });
    const cookiesPath = join(profileDir, 'cookies.json');
    writeFileSync(cookiesPath, JSON.stringify(acc.cookies, null, 2), 'utf-8');
    console.log(`  [${i + 1}] ${acc.email} → id=${id} (${acc.cookies.length} cookies)`);
  } else {
    console.log(`  [${i + 1}] ${acc.email} → id=${id} (SEM cookies!)`);
  }
  
  return record;
});
console.log('');

// 5. Atualiza store.json - substitui TODAS as contas pelas novas
store.accounts = newAccountRecords;

// Mantém outras seções do store intactas (settings, profiles, schedules, logs)
console.log('Salvando store.json atualizado...');
writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');

console.log('\n=== CONCLUÍDO ===');
console.log(`  Contas antes:  ${contasAntes}`);
console.log(`  Contas agora:  ${store.accounts.length}`);
console.log(`  Backup em:     ${backupDir}`);
console.log('');
console.log('Resumo das novas contas:');
store.accounts.forEach((a, i) => {
  console.log(`  ${i + 1}. ${a.email} | proxy: ${a.proxy.split(':')[0]} | id: ${a.id}`);
});
