import cron from 'node-cron';
import { getSchedules, getAccounts, updateAccount, addLog } from './store.js';
import { runWarmupCycle, runWarmupForPeriod, checkExpiredWarmups, cleanupStuckWarmingAccounts } from './warmupWorker.js';
import { TIMINGS } from './warmupTimings.js';
import { broadcast } from './events.js';

const activeCrons = new Map();
const periodCrons = new Map();
let warmupCronJob = null;

// Converte "HH:MM" em expressão cron "MM H * * *"
function timeToCron(timeStr) {
  const [hour, minute] = (timeStr || '09:00').split(':').map(Number);
  return `${minute ?? 0} ${hour ?? 9} * * *`;
}

/**
 * Generate cron expression for a period (0-11) inicia 10min antes e encerra 10min antes
 * Period 0: 00:00-02:00 → inicia 23:50 anterior, encerra 01:50
 */
function generatePeriodCron(period) {
  const startHour = period * 2;
  const startMin = 0;
  
  // Inicia 10 minutos antes do período
  let cronHour = startHour;
  let cronMin = startMin - 10;
  
  if (cronMin < 0) {
    cronMin += 60;
    cronHour -= 1;
    if (cronHour < 0) cronHour = 23;
  }
  
  return `${cronMin} ${cronHour} * * *`;
}

export function initScheduler() {
  setupSchedules();
  setupPeriodSchedules(); // Novo: ativa os 12 períodos
  setupWarmupSchedule();

  const initialAdjustments = checkExpiredWarmups();
  if (initialAdjustments > 0) {
    console.log(`[scheduler] ${initialAdjustments} conta(s) com status de aquecimento ajustado na inicialização.`);
  }

  // Verifica aquecimentos expirados toda hora
  cron.schedule('0 * * * *', () => {
    const n = checkExpiredWarmups();
    if (n > 0) console.log(`[scheduler] ${n} conta(s) com status de aquecimento ajustado.`);
  }, { timezone: 'America/Sao_Paulo' });

  // Limpa contas travadas em warming a cada 5 minutos (IMPORTANTE para evitar estado travado)
  cron.schedule('*/5 * * * *', () => {
    const n = cleanupStuckWarmingAccounts();
    if (n > 0) console.log(`[scheduler] ${n} conta(s) com warming travado foram resetadas.`);
  }, { timezone: 'America/Sao_Paulo' });
}

/**
 * Cria cron jobs para os 12 períodos de 2h
 * Cada período inicia 10min antes e encerra 10min antes do fim
 */
export function setupPeriodSchedules() {
  // Stop previous period crons
  for (const task of periodCrons.values()) task.stop();
  periodCrons.clear();

  for (let period = 0; period < 12; period++) {
    const cronExpr = generatePeriodCron(period);
    
    if (!cron.validate(cronExpr)) {
      console.warn(`[scheduler] Expressão cron inválida para período ${period}: ${cronExpr}`);
      continue;
    }

    const task = cron.schedule(
      cronExpr,
      async () => {
        console.log(`[scheduler] Iniciando período ${period} (${String(period * 2).padStart(2, '0')}:00 - ${String((period + 1) * 2).padStart(2, '0')}:00)`);
        try {
          await runWarmupForPeriod(period);
        } catch (err) {
          console.error(`[scheduler] Erro no período ${period}:`, err.message);
          addLog({
            id: Date.now().toString(),
            type: 'error',
            profileId: null,
            profileName: null,
            message: `Erro no período ${period}: ${err.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      },
      { timezone: 'America/Sao_Paulo' },
    );

    periodCrons.set(period, task);
  }

  console.log(`[scheduler] ${periodCrons.size} período(s) agendado(s)`);
}

export function setupWarmupSchedule() {
  if (warmupCronJob) {
    warmupCronJob.stop();
    warmupCronJob = null;
  }

  const dailyTime = TIMINGS.dailyWarmupTime || '09:00';
  const cronExpr = timeToCron(dailyTime);

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

  console.log(`[scheduler] Aquecimento agendado para: ${dailyTime} (cron: ${cronExpr})`);
}

/**
 * Recria todos os cron jobs a partir dos schedules salvos.
 * Chamado sempre que um schedule é criado, editado ou removido.
 */
export function setupSchedules() {
  // Descarta todos os jobs ativos (compatibilidade com sistema antigo de schedules)
  for (const task of activeCrons.values()) task.stop();
  activeCrons.clear();
  // Sistema de schedules customizados foi substituído por período-baseado em setupPeriodSchedules()
}
