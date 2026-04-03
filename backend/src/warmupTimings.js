/**
 * Tempos e configurações do fluxo de aquecimento.
 * Ajuste esses valores para calibrar o comportamento da automação.
 */
export const TIMINGS = {
  // ── Duração de cada etapa (minutos) ────────────────────
  youtubeWatchMinutes: 10,       // tempo assistindo vídeo no YouTube
  globoNavigateMinutes: 5,       // tempo navegando no globo.com
  gmailBrowseMinutes: 3,         // tempo no Gmail

  // ── Aquecimento geral ──────────────────────────────────
  warmupDays: 3,                 // dias totais de aquecimento
  dailyWarmupTime: '09:00',      // horário de execução diária (HH:MM)
  concurrentBrowsers: 10,        // browsers simultâneos

  // ── Delays humanos (ms) ────────────────────────────────
  typingDelay: 80,               // delay entre cada tecla digitada
  actionDelayMin: 1000,          // delay mínimo entre ações
  actionDelayMax: 3000,          // delay máximo entre ações
  pageLoadWait: 5000,            // espera após carregar página
  loginWaitAfter: 8000,          // espera após login para persistir sessão

  // ── Sessão e browser ───────────────────────────────────
  warmupSessionMinutes: 30,      // duração total máxima de uma sessão
  browserStartupWait: 3000,      // espera após iniciar o browser
};

/**
 * Termos de pesquisa aleatórios para YouTube.
 */
export const YOUTUBE_SEARCH_TERMS = [
  'receitas fáceis do dia a dia',
  'como organizar a casa',
  'dicas de produtividade',
  'melhores filmes 2025',
  'tutorial de excel',
  'como fazer investimentos',
  'treino funcional em casa',
  'viagem pela europa',
  'dicas de fotografia celular',
  'como aprender inglês rápido',
  'receitas de bolo simples',
  'dicas para economizar dinheiro',
  'como montar um PC gamer',
  'jardinagem para iniciantes',
  'melhores séries netflix',
  'como fazer pão caseiro',
  'yoga para iniciantes',
  'decoração de apartamento pequeno',
  'como cuidar de plantas',
  'músicas relaxantes para estudar',
];

/**
 * Retorna um delay aleatório entre min e max.
 */
export function randomDelay(min = TIMINGS.actionDelayMin, max = TIMINGS.actionDelayMax) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Retorna um item aleatório de um array.
 */
export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
