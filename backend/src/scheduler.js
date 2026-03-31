import cron from 'node-cron';
import { getSettings, getSchedules } from './store.js';
import { runProfiles } from './worker.js';
import { runWarmupCycle, checkExpiredWarmups } from './warmupWorker.js';

const activeCrons = new Map();
let warmupCronJob = null;

// Converte "HH:MM" em expressão cron "MM H * * *"
function timeToCron(timeStr) {
  const [hour, minute] = (timeStr || '09:00').split(':').map(Number);
  return `${minute ?? 0} ${hour ?? 9} * * *`;
}

export function initScheduler() {
  setupSchedules();
  setupWarmupSchedule();

  // Verifica aquecimentos expirados toda hora
  cron.schedule('0 * * * *', () => {
    const n = checkExpiredWarmups();
    if (n > 0) console.log(`[scheduler] ${n} conta(s) marcada(s) como aquecida(s).`);
  }, { timezone: 'America/Sao_Paulo' });
}

export function setupWarmupSchedule() {
  if (warmupCronJob) {
    warmupCronJob.stop();
    warmupCronJob = null;
  }

  const { warmupDailyTime } = getSettings();
  const cronExpr = timeToCron(warmupDailyTime || '09:00');

  if (!cron.validate(cronExpr)) {
    console.warn(`[scheduler] Expressão de warmup inválida: ${cronExpr}`);
    return;
  }

  warmupCronJob = cron.schedule(
    cronExpr,
    async () => {
      console.log(`[scheduler] Iniciando ciclo de aquecimento`);
      try {
        await runWarmupCycle();
      } catch (err) {
        console.error(`[scheduler] Erro no aquecimento:`, err.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  console.log(`[scheduler] Aquecimento agendado para: ${warmupDailyTime || '09:00'} (cron: ${cronExpr})`);
}

/**
 * Recria todos os cron jobs a partir dos schedules salvos.
 * Chamado sempre que um schedule é criado, editado ou removido.
 */
export function setupSchedules() {
  // Para e descarta todos os jobs ativos
  for (const task of activeCrons.values()) task.stop();
  activeCrons.clear();

  const schedules = getSchedules();

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;

    if (!cron.validate(schedule.cron)) {
      console.warn(`[scheduler] Expressão cron inválida no schedule "${schedule.id}": ${schedule.cron}`);
      continue;
    }

    const task = cron.schedule(
      schedule.cron,
      async () => {
        console.log(`[scheduler] Executando: ${schedule.label || schedule.id}`);
        try {
          const profileIds =
            !schedule.profileIds || schedule.profileIds.includes('all')
              ? null
              : schedule.profileIds;
          await runProfiles(profileIds);
        } catch (err) {
          console.error(`[scheduler] Falha no schedule "${schedule.id}":`, err.message);
        }
      },
      { timezone: schedule.timezone || 'America/Sao_Paulo' },
    );

    activeCrons.set(schedule.id, task);
  }

  console.log(`[scheduler] ${activeCrons.size} job(s) ativo(s)`);
}
