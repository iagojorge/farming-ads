import axios from 'axios';
import { getSettings } from './store.js';

function getClient() {
  const { adspowerUrl, apiKey } = getSettings();
  return axios.create({
    baseURL: adspowerUrl,
    timeout: 30_000,
    params: apiKey ? { api_key: apiKey } : {},
  });
}

function assertOk(response) {
  if (response.data.code !== 0) {
    throw new Error(response.data.msg || `AdsPower error code ${response.data.code}`);
  }
  return response.data;
}

/**
 * Lista todos os perfis do AdsPower (paginado).
 */
export async function listProfiles({ page = 1, pageSize = 100 } = {}) {
  const client = getClient();
  const res = await client.get('/api/v1/user/list', {
    params: { page, page_size: pageSize },
  });
  assertOk(res);
  return res.data.data?.list || [];
}

/**
 * Inicia o browser de um perfil e retorna dados de debug (ws endpoint, etc).
 */
export async function startBrowser(userId) {
  const client = getClient();
  const res = await client.get('/api/v1/browser/start', {
    params: { user_id: userId, open_tabs: 1, ip_tab: 0 },
  });
  assertOk(res);
  return res.data.data;
}

/**
 * Para o browser de um perfil.
 */
export async function stopBrowser(userId) {
  const client = getClient();
  const res = await client.get('/api/v1/browser/stop', {
    params: { user_id: userId },
  });
  return res.data;
}



/**
 * Verifica se o browser de um perfil está ativo.
 */
export async function getBrowserStatus(userId) {
  const client = getClient();
  const res = await client.get('/api/v1/browser/active', {
    params: { user_id: userId },
  });
  return res.data;
}

/**
 * Lista grupos do AdsPower.
 */
export async function listGroups() {
  const client = getClient();
  const res = await client.get('/api/v1/group/list', {
    params: { page: 1, page_size: 100 },
  });
  assertOk(res);
  return res.data.data?.list || [];
}

/**
 * Cria um grupo no AdsPower e retorna o group_id.
 */
export async function createGroup(groupName) {
  const client = getClient();
  const res = await client.post('/api/v1/group/create', {
    group_name: groupName,
  });
  assertOk(res);
  const data = res.data.data ?? res.data;
  return data?.group_id ?? data?.id;
}

/**
 * Busca um grupo pelo nome; se não existir, cria. Retorna group_id.
 */
async function ensureGroup(groupName) {
  if (!groupName) return '0';
  const groups = await listGroups();
  const found = groups.find(g => g.group_name === groupName);
  if (found) return found.group_id;
  return await createGroup(groupName);
}
/**
 * Parseia proxy no formato host:port:user:pass
 */
function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  const parts = proxyStr.split(':');
  if (parts.length < 2) return null;
  return {
    host: parts[0],
    port: parts[1],
    user: parts[2] || '',
    pass: parts[3] || '',
  };
}

/**
 * Cria um novo perfil no AdsPower com proxy Socks5 e plataforma Gmail.
 * @param {string} profileName
 * @param {{ proxy?: string, email?: string, password?: string }} opts
 * @returns {Promise<string>} user_id do perfil criado
 */
export async function createProfile(profileName, opts = {}) {
  const client = getClient();
  const proxy = parseProxy(opts.proxy);
  const { groupName } = getSettings();

  // Busca ou cria o grupo configurado
  const group_id = await ensureGroup(groupName);

  // Configuração de proxy
  const user_proxy_config = proxy ? {
    proxy_soft: 'other',
    proxy_type: 'socks5',
    proxy_host: proxy.host,
    proxy_port: proxy.port,
    proxy_user: proxy.user,
    proxy_password: proxy.pass,
  } : {
    proxy_soft: 'no_proxy',
  };

  // Configuração de plataforma (Gmail)
  const platform_config = (opts.email && opts.password) ? [{
    platform_url: 'accounts.google.com',
    platform_user_name: opts.email,
    platform_password: opts.password,
  }] : undefined;

  const body = {
    name: profileName,
    group_id: String(group_id),
    user_proxy_config,
    fingerprint_config: {
      automatic_timezone: '1',
      browser: 'chrome',
    },
  };
  if (platform_config) body.platform_config = platform_config;

  const res = await client.post('/api/v1/user/create', body);
  assertOk(res);
  const data = res.data.data ?? res.data;
  const userId = data?.id ?? data?.user_id;
  if (!userId) throw new Error('AdsPower não retornou user_id ao criar perfil');
  return userId;
}

/**
 * Valida um proxy fazendo uma request de teste.
 * @param {string} proxyStr - host:port:user:pass
 * @returns {Promise<{ok: boolean, ip?: string, error?: string}>}
 */
export async function checkProxy(proxyStr) {
  const proxy = parseProxy(proxyStr);
  if (!proxy) return { ok: false, error: 'Formato inválido. Use host:port:user:pass' };
  const client = getClient();
  try {
    const res = await client.post('/api/v1/proxy/check', {
      proxy_type: 'socks5',
      proxy_host: proxy.host,
      proxy_port: proxy.port,
      proxy_user: proxy.user,
      proxy_password: proxy.pass,
    });
    if (res.data?.code === 0) {
      return { ok: true, ip: res.data?.data?.ip || proxy.host };
    }
    return { ok: false, error: res.data?.msg || 'Proxy inválido' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
