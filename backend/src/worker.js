import { startBrowser, stopBrowser } from './adspower.js';
import { getSettings, getProfiles, addLog } from './store.js';
import { broadcast } from './events.js';

// ── Estado do worker ──────────────────────────────────────────
const runningProfiles = new Map(); // profileId -> { name, startedAt, status, endsAt? }
let isRunning = false;
let stopRequested = false;

export function getWorkerStatus() {
  return {
    isRunning,
    runningProfiles: Array.from(runningProfiles.entries()).map(([profileId, info]) => ({
      profileId,
      ...info,
    })),
  };
}

// ── Helpers ───────────────────────────────────────────────────
function makeLog(type, profileId, profileName, message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,        // 'info' | 'success' | 'warn' | 'error'
    profileId,
    profileName,
    message,
    timestamp: new Date().toISOString(),
  };
  addLog(entry);
  broadcast('log', entry);
  return entry;
}

function broadcastStatus() {
  broadcast('status', getWorkerStatus());
}

function setProfileState(id, patch) {
  runningProfiles.set(id, { ...runningProfiles.get(id), ...patch });
  broadcastStatus();
}

/**
 * Sleep interrompível: verifica a flag stopRequested a cada 3 s.
 * Lança erro se o worker for parado durante a espera.
 */
async function sleepOrStop(ms) {
  const TICK = 3_000;
  let elapsed = 0;
  while (elapsed < ms) {
    if (stopRequested) throw new Error('Execução interrompida pelo usuário');
    const wait = Math.min(TICK, ms - elapsed);
    await new Promise((r) => setTimeout(r, wait));
    elapsed += wait;
  }
}

// ── Execução de perfil único ───────────────────────────────────
async function runSingleProfile(profile, settings) {
  const startedAt = new Date().toISOString();
  runningProfiles.set(profile.id, { name: profile.name, startedAt, status: 'iniciando' });
  broadcastStatus();

  makeLog('info', profile.id, profile.name, `Iniciando perfil "${profile.name}"`);

  try {
    // 1. RPA: O AdsPower não expõe endpoints HTTP para configurar RPA automaticamente
    // A solução é configurar manualmente no AdsPower e usar modo "auto"
    if (settings.rpaMode === 'auto') {
      makeLog('info', profile.id, profile.name, `✅ RPA em modo 'auto' — será executado conforme configurado no AdsPower`);
    } else if (settings.rpaMode === 'api') {
      // Se usuário forçar modo API, apenas avisa que não funciona
      makeLog('warn', profile.id, profile.name, `⚠️ Modo API do RPA não disponível no este AdsPower. Use modo 'Auto' em vez disso.`);
    }

    // 2. Abre o browser (RPA vai rodar automaticamente se foi configurado no AdsPower)
    setProfileState(profile.id, { status: 'abrindo browser' });
    await startBrowser(profile.id);
    setProfileState(profile.id, { status: 'browser aberto' });
    makeLog('info', profile.id, profile.name, `Browser aberto para "${profile.name}"`);

    // Aguarda o browser estar pronto e RPA iniciar
    await sleepOrStop(3000);

    // 3. Aguarda a duração configurada (farming acontece aqui)
    const durationMin = profile.durationMinutes ?? settings.defaultDurationMinutes ?? 30;
    const durationMs = durationMin * 60 * 1_000;
    const endsAt = new Date(Date.now() + durationMs).toISOString();

    setProfileState(profile.id, { status: 'farming', endsAt });
    makeLog(
      'info',
      profile.id,
      profile.name,
      `Farming ativo — aguardando ${durationMin} minuto(s) (até ${new Date(endsAt).toLocaleTimeString('pt-BR')})`,
    );

    await sleepOrStop(durationMs);

    // 4. Aguarda um tempo e fecha o browser
    await sleepOrStop(3000);

    // 5. Fecha o browser
    await stopBrowser(profile.id);

    const totalMin = Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000);
    makeLog('success', profile.id, profile.name, `Perfil "${profile.name}" concluído (${totalMin} min)`);
  } catch (err) {
    makeLog('error', profile.id, profile.name, `Erro em "${profile.name}": ${err.message}`);
    try {
      await stopBrowser(profile.id);
    } catch {
      // ignora erro ao fechar browser após falha
    }
  } finally {
    runningProfiles.delete(profile.id);
    broadcastStatus();
  }
}

// ── API pública ───────────────────────────────────────────────
/**
 * Executa o farming para os perfis especificados (ou todos os habilitados).
 * @param {string[]|null} profileIds - null = todos os habilitados
 */
export async function runProfiles(profileIds = null) {
  if (isRunning) throw new Error('Worker já está em execução');

  isRunning = true;
  stopRequested = false;
  broadcastStatus();

  const settings = getSettings();
  let targets = getProfiles().filter((p) => p.enabled);
  if (profileIds?.length) targets = targets.filter((p) => profileIds.includes(p.id));

  makeLog('info', null, null, `Iniciando execução para ${targets.length} perfil(is)`);

  if (targets.length === 0) {
    makeLog('warn', null, null, 'Nenhum perfil habilitado encontrado');
    isRunning = false;
    broadcastStatus();
    return;
  }

  const concurrency = Math.max(1, settings.concurrentProfiles || 1);

  for (let i = 0; i < targets.length; i += concurrency) {
    if (stopRequested) break;
    const batch = targets.slice(i, i + concurrency);
    await Promise.all(batch.map((p) => runSingleProfile(p, settings)));
  }

  makeLog('info', null, null, `Execução finalizada${stopRequested ? ' (interrompida)' : ''}`);
  isRunning = false;
  stopRequested = false;
  broadcastStatus();
}

/**
 * Para o worker imediatamente, fechando browsers em execução.
 */
export function stopWorker() {
  stopRequested = true;
  isRunning = false;
  const profilesToStop = [...runningProfiles.keys()];
  runningProfiles.clear();
  broadcastStatus();
  // Fecha browsers em background (best-effort)
  for (const id of profilesToStop) {
    stopBrowser(id).catch(() => {});
  }
  makeLog('warn', null, null, 'Worker interrompido manualmente');
}
