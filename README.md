# 🌱 Farming Ads

Sistema automatizado de aquecimento de contas Google para Google Ads, utilizando **Playwright** para automação de browser e um **dashboard web** em tempo real para gerenciamento.

---

## Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Stack Tecnológica](#stack-tecnológica)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Execução](#execução)
- [Fluxo Completo de Aquecimento](#fluxo-completo-de-aquecimento)
- [Backend — Detalhamento](#backend--detalhamento)
  - [Servidor (index.js)](#servidor-indexjs)
  - [Persistência (store.js)](#persistência-storejs)
  - [Autenticação (auth.js)](#autenticação-authjs)
  - [Eventos SSE (events.js)](#eventos-sse-eventsjs)
  - [Motor de Aquecimento (warmupEngine.js)](#motor-de-aquecimento-warmupenginejs)
  - [Orquestrador de Aquecimento (warmupWorker.js)](#orquestrador-de-aquecimento-warmupworkerjs)
  - [Agendamento (scheduler.js)](#agendamento-schedulerjs)
  - [Proxy SOCKS5 (socksProxy.js)](#proxy-socks5-socksproxyjs)
  - [Troca de Email de Recuperação (recoveryEmailWorker.js)](#troca-de-email-de-recuperação-recoveryemailworkerjs)
  - [Timings (warmupTimings.js)](#timings-warmuptimingsjs)
  - [API REST (routes/api.js)](#api-rest-routesapijs)
- [Frontend — Detalhamento](#frontend--detalhamento)
  - [Páginas](#páginas)
  - [Componentes](#componentes)
  - [API Client](#api-client)
- [Modelo de Dados](#modelo-de-dados)
- [Sistema de Períodos](#sistema-de-períodos)
- [Deploy em Produção (VPS)](#deploy-em-produção-vps)
- [Referência da API](#referência-da-api)

---

## Visão Geral

O **Farming Ads** automatiza o processo de "aquecer" contas Google novas para que estejam prontas para uso no Google Ads. O ciclo completo leva **3 dias** e inclui:

1. **Login automatizado** no Google (com suporte a 2FA via email de recuperação)
2. **Navegação em YouTube** — pesquisa, assiste vídeos, se inscreve em canais
3. **Navegação em Globo.com** — simula leitura de notícias com scroll natural
4. **Gmail** — tempo de permanência logado
5. **Criação de conta Google Ads** — ao final do dia 3
6. **Geração de API Key** no Google Cloud Console — automatizada com criação de projeto

Após o aquecimento, as contas ficam disponíveis para exportação com cookies, API Key e Ads Account ID.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│  React + Vite + TailwindCSS (SPA)                       │
│  Dashboard, Contas, Agendamento, Logs, Prontas, Segurança│
│                                                          │
│   SSE ←──────── /api/events ────────── real-time updates │
│   HTTP ←──────→ /api/* ─────────────→ REST endpoints     │
└─────────────────────┬───────────────────────────────────┘
                      │ Proxy (Vite dev) ou nginx (prod)
┌─────────────────────▼───────────────────────────────────┐
│                      BACKEND                             │
│  Node.js + Express                                       │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ auth.js  │  │  store.js    │  │  events.js (SSE)   │ │
│  │ JWT auth │  │  JSON persist│  │  broadcast()       │ │
│  └──────────┘  └──────────────┘  └────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           warmupEngine.js (Playwright)            │   │
│  │  loginGoogle → YouTube → Globo → Gmail → Ads     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │warmupWorker.js│  │scheduler │  │recoveryEmail     │  │
│  │  orchestrator │  │ node-cron│  │  Worker.js       │  │
│  └──────────────┘  └──────────┘  └──────────────────┘  │
│                                                          │
│  ┌──────────────┐                                        │
│  │ socksProxy.js│  HTTP→SOCKS5 tunnel bridge             │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
                      │
              ┌───────▼────────┐
              │  data/         │
              │  ├─ store.json │  Banco de dados (JSON)
              │  └─ profiles/  │  Perfis Chromium persistentes
              │     └─ <id>/   │  (cookies, localStorage, etc.)
              └────────────────┘
```

---

## Stack Tecnológica

### Backend
| Tecnologia | Versão | Uso |
|---|---|---|
| Node.js | ≥ 18 | Runtime |
| Express | 4.18 | HTTP server + REST API |
| Playwright | 1.58 | Automação de browser (Chromium) |
| jsonwebtoken | 9.0 | Autenticação JWT |
| node-cron | 3.0 | Agendamento de tarefas |
| socks | 2.8 | Cliente SOCKS5 para proxies |
| cors | 2.8 | Cross-Origin Resource Sharing |

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 18.2 | Framework de UI |
| Vite | 5.0 | Build tool e dev server |
| TailwindCSS | 3.4 | Estilização utility-first |
| react-router-dom | 7.13 | Roteamento SPA |
| lucide-react | 0.344 | Ícones |
| sonner | 1.4 | Toasts / notificações |

---

## Estrutura de Diretórios

```
farming-ads/
├── package.json                    # Raiz do monorepo (scripts: dev, install:all, build)
├── README.md                       # Esta documentação
│
├── backend/
│   ├── package.json                # Dependências backend (type: "module")
│   └── src/
│       ├── index.js                # Entry point — Express server (porta 3001)
│       ├── auth.js                 # Autenticação JWT (admin/#agenciatitan2026)
│       ├── store.js                # Persistência JSON (data/store.json)
│       ├── events.js               # Server-Sent Events (SSE) — real-time
│       ├── scheduler.js            # Agendamento com node-cron (12 períodos)
│       ├── worker.js               # Fachada de status do worker
│       ├── warmupEngine.js         # ⭐ CORE — Motor Playwright (login, YouTube, Globo, Gmail, Ads)
│       ├── warmupWorker.js         # Orquestrador de sessões de aquecimento
│       ├── warmupTimings.js        # Constantes de timing e termos de busca
│       ├── socksProxy.js           # Bridge HTTP→SOCKS5 para proxies autenticados
│       ├── loginWorker.js          # Worker de login (desabilitado — login integrado ao warmup)
│       ├── recoveryEmailWorker.js  # Worker de troca de email de recuperação
│       └── routes/
│           └── api.js              # Todas as rotas REST (30+ endpoints)
│
├── frontend/
│   ├── package.json
│   ├── index.html                  # HTML base
│   ├── vite.config.js              # Proxy /api → backend:3001
│   ├── tailwind.config.js          # Tema customizado (brand colors)
│   ├── postcss.config.js           # PostCSS para Tailwind
│   └── src/
│       ├── main.jsx                # Entry point React
│       ├── index.css               # Global CSS + Tailwind imports
│       ├── App.jsx                 # Router + Layout + SSE connection
│       ├── api/
│       │   └── index.js            # Cliente HTTP (fetch wrapper + SSE)
│       ├── components/
│       │   ├── Sidebar.jsx         # Navegação lateral (6 itens)
│       │   └── LogEntry.jsx        # Renderização de log individual
│       ├── hooks/
│       │   ├── useAuth.js          # Hook de autenticação (JWT localStorage)
│       │   └── useCountdown.js     # Hook de countdown timer
│       └── pages/
│           ├── Dashboard.jsx       # Visão geral com gráficos e progresso em tempo real
│           ├── Accounts.jsx        # CRUD de contas (individual + batch CSV)
│           ├── Schedule.jsx        # Alocação de contas em períodos de 2h
│           ├── Logs.jsx            # Visualizador de logs com filtros
│           ├── ReadyAccounts.jsx   # Contas prontas — exportação e Google Ads
│           ├── Security.jsx        # Troca de email de recuperação em massa
│           └── Login.jsx           # Tela de login
│
└── data/                           # Gerado em runtime (gitignored)
    ├── store.json                  # Banco de dados JSON
    └── profiles/                   # Perfis de browser Chromium
        └── <account-id>/          # Um diretório por conta
            ├── Default/            # Dados do Chromium (localStorage, sessionStorage, etc.)
            └── cookies.json        # Cookies exportados
```

---

## Pré-requisitos

- **Node.js** ≥ 18 (recomendado: v20 LTS)
- **npm** ≥ 9
- **Playwright Chromium** — instalado automaticamente via `npx playwright install chromium`
- **Proxies** — cada conta precisa de um proxy dedicado (HTTP ou SOCKS5)

---

## Instalação

```bash
# 1. Clonar o repositório
git clone <repo-url> farming-ads
cd farming-ads

# 2. Instalar todas as dependências (raiz + backend + frontend)
npm run install:all

# 3. Instalar browser Chromium do Playwright
cd backend && npx playwright install chromium && cd ..

# 4. Build do frontend (para produção)
cd frontend && npm run build && cd ..
```

---

## Configuração

### Variáveis de Ambiente (Backend)

Criar `.env` na pasta `backend/`:

```env
PORT=3001                          # Porta do servidor
JWT_SECRET=sua-chave-secreta       # Secret para tokens JWT
FRONTEND_URL=http://localhost:5173 # URL do frontend (CORS)
HEADLESS=true                      # true para VPS (sem display), false para debug local
```

### Credenciais de Acesso

| Campo | Valor |
|---|---|
| Usuário | `admin` |
| Senha | `#agenciatitan2026` |

> Definido em `backend/src/auth.js`. Para alterar, edite o objeto `USERS`.

---

## Execução

### Desenvolvimento (local)

```bash
# Roda backend + frontend em paralelo (hot-reload)
npm run dev
```

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:5173` (proxy automático para `/api`)

### Produção (VPS)

```bash
# Build do frontend
cd frontend && npm run build && cd ..

# Iniciar o backend (serve o frontend buildado via nginx)
cd backend && node src/index.js
```

---

## Fluxo Completo de Aquecimento

```
                    CICLO DE VIDA DE UMA CONTA
                    ══════════════════════════

 ┌──────────┐    startWarmup()    ┌──────────┐
 │ pending  │ ──────────────────→ │ warming  │
 └──────────┘                     └────┬─────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
     ┌────▼────┐                  ┌────▼────┐                 ┌────▼────┐
     │  Dia 1  │                  │  Dia 2  │                 │  Dia 3  │
     └────┬────┘                  └────┬────┘                 └────┬────┘
          │                            │                            │
    ┌─────▼──────┐              ┌─────▼──────┐              ┌─────▼──────┐
    │ Login      │              │ Login      │              │ Login      │
    │ YT Channel │              │ YouTube    │              │ YouTube    │
    │ YouTube    │              │ Globo      │              │ Globo      │
    │ Globo      │              │ Gmail      │              │ Gmail      │
    │ Gmail      │              └────────────┘              │ Google Ads │
    └────────────┘                                          │ API Key   │
                                                            └─────┬─────┘
                                                                  │
                                                          ┌───────▼───────┐
                                                          │ ready_for_ads │
                                                          └───────────────┘
```

### Dia 1 — Inicialização
1. **Login no Google** — Navega para `accounts.google.com/signin`, preenche email/senha, resolve desafios de segurança (2FA via email de recuperação, checkpoints, passkeys, etc.)
2. **Criação do canal YouTube** — Acessa `studio.youtube.com`, preenche nome do canal e confirma
3. **Navegação YouTube** — Pesquisa termo aleatório (de 20 termos em português), clica em vídeo, se inscreve no canal, assiste por 10 minutos
4. **Navegação Globo** — Acessa `globo.com`, clica em links de notícias aleatórios, faz scroll lento por 5 minutos
5. **Gmail** — Permanece logado por 3 minutos

### Dia 2 — Reforço
1. Login → YouTube (10min) → Globo (5min) → Gmail (3min)
2. Mesmo fluxo do Dia 1, sem criação de canal YouTube

### Dia 3 — Finalização + Google Ads
1. Login → YouTube (10min) → Globo (5min) → Gmail (3min)
2. **Criação de conta Google Ads:**
   - Navega para `ads.google.com`
   - Clica "Começar agora"
   - Captura o ID da conta Google Ads (do URL ou HTML)
3. **Geração de API Key no Cloud Console:**
   - Navega para `console.cloud.google.com/apis/credentials`
   - Aceita termos/modal se aparecer (checkbox + confirmar)
   - Cria projeto se necessário (formulário de criação)
   - Clica "Criar credenciais" → "Chave de API"
   - (Opcional) Seleciona restrição "Google Ads API"
   - Captura a chave gerada (formato `AIza...`)
4. Conta marcada como `ready_for_ads`
5. Cookies salvos em `data/profiles/<id>/cookies.json`

---

## Backend — Detalhamento

### Servidor (`index.js`)

Entry point do Express. Configurações:
- CORS habilitado para `FRONTEND_URL`
- Body parser JSON
- Monta todas as rotas em `/api`
- Inicializa store e scheduler no boot
- Graceful shutdown: fecha tunnels SOCKS5 no `SIGINT`

### Persistência (`store.js`)

Banco de dados em arquivo JSON (`data/store.json`). Leitura síncrona no boot, persistência síncrona a cada mutação.

**Estrutura do store:**
```json
{
  "settings": {
    "concurrentBrowsers": 5,
    "timezone": "America/Sao_Paulo"
  },
  "accounts": [...],
  "logs": [],
  "schedules": [],
  "profiles": []
}
```

**Funções exportadas:**
| Função | Descrição |
|---|---|
| `initStore()` | Carrega ou cria `data/store.json` |
| `getAccounts()` / `addAccount()` / `addAccounts()` | CRUD de contas |
| `updateAccount(id, data)` | Merge parcial (spread) e persiste |
| `deleteAccount(id)` | Remove conta |
| `getAccountsByStatus(status)` | Filtra por status |
| `addLog(entry)` / `getLogs()` / `clearLogs()` | Gestão de logs (max 500) |
| `getSettings()` / `updateSettings()` | Configurações |

### Autenticação (`auth.js`)

JWT com expiração de 7 dias. Credenciais hardcoded.

| Função | Descrição |
|---|---|
| `validateCredentials(user, pass)` | Valida contra mapa interno |
| `generateToken(username)` | Assina JWT |
| `authMiddleware(req, res, next)` | Middleware Express — verifica `Authorization: Bearer <token>` |

### Eventos SSE (`events.js`)

Server-Sent Events para comunicação real-time com o frontend.

| Função | Descrição |
|---|---|
| `addClient(res)` | Registra stream SSE |
| `removeClient(res)` | Remove ao desconectar |
| `broadcast(event, data)` | Envia para todos os clientes conectados |

**Eventos emitidos:**
| Evento | Quando |
|---|---|
| `status` | Conexão inicial (status do worker) |
| `log` | Cada log gerado pelo sistema |
| `account-update` | Mudança de status/progresso de conta |
| `warming-status` | Worker começou/parou |
| `login-status` | Status do login worker |
| `recovery-status` | Status do recovery worker |

### Motor de Aquecimento (`warmupEngine.js`)

**Arquivo central do sistema** (~1275 linhas). Contém toda a lógica de automação via Playwright.

#### Funções Internas (Helpers)

| Função | Descrição |
|---|---|
| `sleep(ms)` | Delay assíncrono |
| `humanDelay()` | Delay aleatório (1-3s) para simular comportamento humano |
| `safeType(page, sel, text)` | Espera seletor, limpa campo, digita com delay por tecla |
| `safeClick(page, sel)` | Espera seletor, delay humano, clica |
| `goToWithRetry(page, url)` | Navegação com até 3 retries e backoff exponencial |
| `parseProxy(str)` | Parse de proxy `host:port:user:pass` ou `socks5://...` |
| `clickButtonByText(page, patterns)` | Busca botões por regex no DOM via `evaluate()` |
| `isLoggedInUrl(url)` | Verifica se URL indica login bem-sucedido |
| `clickFirst(page, selectors, label)` | **Chave** — tenta múltiplos seletores CSS/XPath, clica no primeiro visível |

#### Login no Google (`loginGoogle`)

Fluxo robusto de login que lida com múltiplos cenários:

1. **Account chooser** — detecta se tem lista de contas, clica na correta ou "Usar outra conta"
2. **Email** — preenche e submete
3. **Senha** — preenche e submete
4. **Loop de segurança** (até 15 rodadas):
   - **2FA via recovery email** — 4 estratégias de detecção:
     1. Seletor `[data-challengetype="12"]` (tipo recovery email)
     2. Busca por texto "e-mail de recuperação" em elementos
     3. Busca pelo domínio do email de recuperação na página
     4. Clica "Tentar de outra forma" e retenta as 3 acima
   - **Telas de segurança** — pula "Não perca o acesso", "Adicionar telefone", "Definir endereço", etc.
   - **Checkpoint** — detecta bloqueios do Google
   - **Passkey/Speedbump** — força navegação para `myaccount.google.com`
   - **Fallback** — preenche inputs via DOM events (character-by-character)

#### Navegação YouTube (`browseYouTube`)

1. Navega para `youtube.com`
2. Aceita termos/cookies se solicitado
3. Verifica se está logado (avatar no canto)
4. Troca idioma para pt-BR se necessário
5. Pesquisa termo aleatório (de 20 termos pré-definidos)
6. Clica em vídeo aleatório dos 5 primeiros resultados
7. Se inscreve no canal do vídeo
8. Assiste por 10 minutos (configurable via `TIMINGS.youtubeWatchMinutes`)

#### Criação de Conta Google Ads + API Key (`createGoogleAdsAccount`)

**Parte 1 — Google Ads:**
- Navega para `ads.google.com`
- Clica "Começar agora" (XPath + fallbacks CSS)
- Captura Account ID do URL (`ocid=` / `customerId=`) ou do HTML (regex `\d{3}-\d{3}-\d{4}`)

**Parte 2 — Cloud Console (Projeto):**
- Navega para `console.cloud.google.com/apis/credentials`
- Detecta e aceita modal de termos (checkbox + botão confirmar em `mat-dialog-container` ou `[role="dialog"]`)
- Se necessário, cria projeto (clica `cfc-message-actions button` → confirma com XPath do formulário `proj-creation-form`)
- Renavega para credenciais após criação

**Parte 3 — API Key:**
1. Clica "Criar credenciais" (`[id$="action-bar-create-button"]`)
2. Seleciona "Chave de API" no dropdown (`cfc-menu-item`)
3. Abre dropdown de restrição (`cfc-select`)
4. Seleciona "Google Ads API" (`mat-option`)
5. Confirma seleção (OK)
6. Clica "Criar" (`cfc-progress-button`)
7. Captura a chave de `mat-form-field input/textarea` ou regex `AIza[A-Za-z0-9_-]{35,39}`

**Retorno:** `{ apiKey: string|null, googleAdsAccountId: string|null }`

#### Funções Exportadas

| Função | Descrição |
|---|---|
| `runWarmupSession(account, log, dayNumber)` | Sessão completa de aquecimento. Abre Chromium persistente com proxy, executa todo o pipeline do dia. Retorna `{ success, googleAdsApiKey?, googleAdsAccountId? }` |
| `runGoogleAdsOnly(account, log)` | Login + apenas fluxo Google Ads + API Key. Para contas já aquecidas que ainda não tem API Key |
| `loginGoogle`, `clickFirst`, `sleep`, `parseProxy`, `PROFILES_DIR` | Re-exportados para uso por outros workers |

### Orquestrador de Aquecimento (`warmupWorker.js`)

Gerencia a execução de sessões de aquecimento com controle de concorrência.

| Função | Descrição |
|---|---|
| `getWarmupWorkerStatus()` | Status com períodos ativos |
| `startWarmup(accountId)` | Transiciona conta para `warming`, define `warmupStartDate` e `warmupEndDate` (+3 dias) |
| `runSingleWarmup(account)` | Executa 1 sessão: atualiza status → chama `runWarmupSession` → incrementa `warmupDaysDone` → marca `ready_for_ads` se completo |
| `runWarmupForPeriod(period)` | Aquece contas alocadas em um período específico |
| `runWarmupForSelectedAccounts(ids)` | Aquecimento manual por seleção |
| `runGoogleAdsForAccounts(ids)` | Executa apenas fluxo Google Ads em batch |
| `runWarmupCycle()` | Ciclo diário: marca expirados, inicia pendentes, aquece todos |
| `checkExpiredWarmups()` | Marca contas com `warmupEndDate` passada como `ready_for_ads` |
| `cleanupStuckWarmingAccounts()` | Reset de contas travadas em `warming` |

**Controle de concorrência:** Processa em batches de `concurrentBrowsers` (padrão: 10) usando `Promise.all`.

### Agendamento (`scheduler.js`)

Usa `node-cron` para agendar execuções automáticas.

**Cron jobs criados:**
| Job | Frequência | Ação |
|---|---|---|
| Período 0-11 | A cada 2h (10min antes do período) | `runWarmupForPeriod(period)` |
| Ciclo diário | `TIMINGS.dailyWarmupTime` (09:00) | `runWarmupCycle()` |
| Check expirados | A cada hora | `checkExpiredWarmups()` |
| Cleanup travados | A cada 5 min | `cleanupStuckWarmingAccounts()` |

### Proxy SOCKS5 (`socksProxy.js`)

Playwright suporta proxy HTTP com autenticação mas **não** suporta SOCKS5 com autenticação nativamente. Este módulo cria um servidor HTTP local temporário que faz bridge:

```
Playwright → HTTP CONNECT → localhost:RANDOM_PORT → SOCKS5 → Destino
```

| Função | Descrição |
|---|---|
| `createSocksProxyTunnel(host, port, user, pass)` | Cria servidor HTTP local que tunela via SOCKS5. Retorna `{ port, url, close() }` |
| `closeAllProxies()` | Fecha todos os tunnels ativos |
| `getActiveProxyCount()` | Quantidade de tunnels ativos |

### Troca de Email de Recuperação (`recoveryEmailWorker.js`)

Worker para alterar o email de recuperação de contas Google em massa.

**Email alvo:** `iagojorge@agencia-titan.com` (hardcoded)

**Fluxo por conta:**
1. Abre browser Chromium persistente com proxy
2. Faz login via `loginGoogle()`
3. Navega para `myaccount.google.com/security`
4. Verifica se email de recuperação já é o correto (skip se sim)
5. Clica no link "E-mail de recuperação"
6. Re-autentica se Google pedir senha novamente
7. Clica em Editar / Adicionar
8. Preenche o novo email
9. Confirma (Próxima / Salvar)
10. Google pede código de verificação → **considerado sucesso** (não precisa validar)
11. Atualiza `recoveryEmail` no store

**Validações:**
- Se `recoveryEmail` já é o email alvo, pula a conta
- Execução sequencial (1 conta por vez) para evitar problemas

| Função | Descrição |
|---|---|
| `getRecoveryWorkerStatus()` | `{ isRunning }` |
| `runRecoveryEmailUpdate(accountIds)` | Executa troca para múltiplas contas |

### Timings (`warmupTimings.js`)

Constantes que controlam o comportamento temporal do sistema:

| Constante | Valor | Descrição |
|---|---|---|
| `warmupDays` | 3 | Dias totais de aquecimento |
| `youtubeWatchMinutes` | 10 | Tempo assistindo YouTube |
| `globoNavigateMinutes` | 5 | Tempo navegando Globo |
| `gmailBrowseMinutes` | 3 | Tempo no Gmail |
| `concurrentBrowsers` | 10 | Browsers simultâneos |
| `typingDelay` | 80ms | Delay entre teclas |
| `actionDelayMin/Max` | 1000-3000ms | Delay entre ações |
| `pageLoadWait` | 5000ms | Espera após carregar página |
| `loginWaitAfter` | 8000ms | Espera após submeter login |
| `browserStartupWait` | 3000ms | Espera após abrir browser |
| `warmupSessionMinutes` | 30 | Duração máxima da sessão |

**Termos de busca YouTube:** 20 termos em português (receitas, produtividade, viagens, tecnologia, etc.)

### API REST (`routes/api.js`)

Todas as rotas montadas em `/api`. Rotas após `authMiddleware` exigem JWT.

#### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/login` | Login → JWT |
| `POST` | `/auth/logout` | Logout (no-op) |

#### SSE
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/events?token=` | Stream SSE (token via query string) |

#### Configurações
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/settings` | Obter configurações |
| `PUT` | `/settings` | Atualizar configurações |

#### Contas
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/accounts` | Listar todas |
| `POST` | `/accounts` | Criar conta individual |
| `POST` | `/accounts/batch` | Criar múltiplas contas (CSV) |
| `PUT` | `/accounts/:id` | Atualizar conta |
| `DELETE` | `/accounts/:id` | Deletar conta |
| `POST` | `/accounts/test-proxy` | Testar proxy via Playwright |
| `POST` | `/accounts/export-cookies` | Exportar cookies (Netscape format) |

#### Login
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/accounts/login-status` | Status do login worker |
| `POST` | `/accounts/login` | Iniciar login em contas |
| `POST` | `/accounts/login/stop` | Parar login |

#### Aquecimento
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/warmup/status` | Status com contagens por status |
| `POST` | `/warmup/run` | Iniciar aquecimento (manual) |
| `POST` | `/warmup/check-expired` | Marcar expirados como prontos |
| `POST` | `/warmup/google-ads` | Executar apenas fluxo Google Ads |
| `POST` | `/warmup/cleanup-stuck` | Limpar contas travadas |
| `POST` | `/accounts/:id/warmup` | Iniciar aquecimento de conta específica |

#### Agendamento
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/schedule/periods` | 12 períodos com contas alocadas |
| `POST` | `/schedule/allocate` | Alocar conta em período |
| `DELETE` | `/schedule/allocate/:id` | Remover alocação |

#### Email de Recuperação
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/accounts/recovery-status` | Status do worker |
| `POST` | `/accounts/update-recovery-email` | Iniciar troca de email |

#### Logs
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/logs?limit=&offset=` | Obter logs paginados |
| `DELETE` | `/logs` | Limpar todos os logs |

---

## Frontend — Detalhamento

### Páginas

#### Dashboard (`Dashboard.jsx`)
- **Stat cards** — Total, Aquecendo, Prontas, Pendentes, Erros, Taxa de conclusão
- **Gráfico donut** — Distribuição visual de contas por status (SVG animado)
- **Barra de distribuição por dia** — Quantas contas em cada dia de warmup (0, 1, 2, 3)
- **Contas aquecendo agora** — Cards em tempo real com email, etapa atual (YouTube/Globo/Gmail), progresso
- **Tabela de progresso** — Todas as contas com barra de progresso e última data de warmup
- **Logs recentes** — Últimos 30 logs em tempo real via SSE

#### Contas (`Accounts.jsx`)
- **Formulário individual** — Email, senha, proxy (`host:port:user:pass`), email de recuperação
- **Import batch** — Textarea para CSV (`email,senha,proxy,recoveryEmail` por linha)
- **Tabela de contas** — Seleção múltipla, status badges, barra de progresso, botão deletar
- **Ação em lote** — "Aquecer" contas selecionadas

#### Agendamento (`Schedule.jsx`)
- **12 cards de período** — Cada um representando um slot de 2h (00:00-02:00 até 22:00-00:00)
- **Capacidade** — Máximo 10 contas por período
- **Alocação** — Modal para adicionar contas não alocadas
- **Remoção** — Hover no card para remover alocação

#### Logs (`Logs.jsx`)
- **Filtros** — todos, info, success, warn, error
- **Live feed** — Logs aparecem em tempo real via SSE
- **Auto-scroll** — Toggle para scroll automático
- **Paginação** — Load more (100 por página)
- **Limpar** — Botão para deletar todos os logs

#### Contas Prontas (`ReadyAccounts.jsx`)
- **Tabela** — Email, proxy, dias (X/3), Ads ID, API Key, data de conclusão
- **Exportação .txt** — Gera arquivo com email, senha, proxy, API key, Ads ID + cookies em formato Netscape
- **Google Ads** — Botão para executar fluxo de API Key em contas que ainda não têm

#### Segurança (`Security.jsx`)
- **Stats** — Total, email correto (verde), precisa trocar (amarelo)
- **Tabela** — Email da conta, email de recuperação atual, status (OK / Trocar / Vazio)
- **Ação** — "Trocar Email (N)" para contas selecionadas ou todas que precisam

### Componentes

| Componente | Descrição |
|---|---|
| `Sidebar.jsx` | Navegação lateral com 6 itens, branding, status do worker, logout |
| `LogEntry.jsx` | Renderiza entrada de log com ícone por nível e timestamp |

### API Client (`api/index.js`)

Wrapper `fetch` que:
- Anexa JWT do `localStorage` em cada request
- Redireciona para `/login` em caso de 401
- Base: `/api` (proxied pelo Vite ou nginx)
- Exporta `createEventSource()` para SSE com auto-reconnect

---

## Modelo de Dados

### Account (Conta)

```typescript
interface Account {
  id: string;                    // UUID gerado na criação
  email: string;                 // Email da conta Google
  password: string;              // Senha da conta
  proxy: string;                 // "host:port:user:pass" ou "socks5://host:port:user:pass"
  recoveryEmail: string;         // Email de recuperação (usado para 2FA)
  status: AccountStatus;         // Estado no ciclo de vida
  warmupStatus: WarmupStatus;    // Estado da sessão atual
  warmupCurrentStep: string;     // Etapa atual (youtube, globo, gmail, google-ads, done)
  warmupDaysDone: number;        // Dias completados (0-3)
  warmupProgress: number;        // Progresso percentual (0-100)
  warmupStartDate: string;       // ISO date — início do aquecimento
  warmupEndDate: string;         // ISO date — fim previsto (+3 dias)
  lastWarmupAt: string;          // ISO datetime — última sessão
  schedulePeriod: number | null; // Período alocado (0-11) ou null
  googleAdsApiKey: string;       // Chave de API gerada
  googleAdsAccountId: string;    // ID da conta Google Ads
  profileId: string;             // ID do perfil de browser
  error: string;                 // Último erro
  createdAt: string;             // ISO datetime
}

type AccountStatus = 'pending' | 'warming' | 'ready_for_ads' | 'synced' | 'error' | 'checkpoint';
type WarmupStatus = 'idle' | 'warming' | 'paused' | 'completed';
```

### Ciclo de Status

```
pending → warming → ready_for_ads → synced
    │         │
    │         └──→ checkpoint (bloqueio do Google)
    │         └──→ error
    └──→ error
```

---

## Sistema de Períodos

O agendamento divide o dia em **12 períodos de 2 horas**:

| Período | Horário | Cron (10min antes) |
|---|---|---|
| 0 | 00:00 - 02:00 | `50 23 * * *` |
| 1 | 02:00 - 04:00 | `50 1 * * *` |
| 2 | 04:00 - 06:00 | `50 3 * * *` |
| 3 | 06:00 - 08:00 | `50 5 * * *` |
| 4 | 08:00 - 10:00 | `50 7 * * *` |
| 5 | 10:00 - 12:00 | `50 9 * * *` |
| 6 | 12:00 - 14:00 | `50 11 * * *` |
| 7 | 14:00 - 16:00 | `50 13 * * *` |
| 8 | 16:00 - 18:00 | `50 15 * * *` |
| 9 | 18:00 - 20:00 | `50 17 * * *` |
| 10 | 20:00 - 22:00 | `50 19 * * *` |
| 11 | 22:00 - 00:00 | `50 21 * * *` |

**Máximo:** 10 contas por período.

Contas alocadas a um período são aquecidas automaticamente quando o cron do período dispara.

---

## Deploy em Produção (VPS)

### Systemd Service

```ini
[Unit]
Description=Farming Ads Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/farming-ads/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HEADLESS=true
Environment=JWT_SECRET=sua-chave-secreta

[Install]
WantedBy=multi-user.target
```

### Nginx (Reverse Proxy)

```nginx
server {
    listen 80;
    server_name seu-ip-ou-dominio;

    # Frontend (build estático)
    location / {
        root /root/farming-ads/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API Backend
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE (timeout longo)
    location /api/events {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

### Comandos úteis

```bash
# Reiniciar serviço
sudo systemctl restart farming-ads

# Ver logs em tempo real
sudo journalctl -u farming-ads -f

# Rebuild frontend e reiniciar
cd /root/farming-ads/frontend && npm run build
sudo systemctl restart farming-ads
```

---

## Referência da API

Base URL: `http://localhost:3001/api` (dev) ou `http://seu-servidor/api` (prod)

Todos os endpoints (exceto `/auth/login` e `/events`) requerem header:
```
Authorization: Bearer <jwt-token>
```

### Autenticação

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"#agenciatitan2026"}'

# Resposta: { "token": "eyJ..." }
```

### Contas

```bash
# Listar contas
curl http://localhost:3001/api/accounts -H "Authorization: Bearer $TOKEN"

# Adicionar conta
curl -X POST http://localhost:3001/api/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"conta@gmail.com","password":"senha123","proxy":"host:port:user:pass","recoveryEmail":"recovery@email.com"}'

# Batch import
curl -X POST http://localhost:3001/api/accounts/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accounts":[{"email":"a@gmail.com","password":"123","proxy":"h:p:u:pw"}]}'
```

### Aquecimento

```bash
# Iniciar aquecimento
curl -X POST http://localhost:3001/api/warmup/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountIds":["id1","id2"]}'

# Executar apenas Google Ads
curl -X POST http://localhost:3001/api/warmup/google-ads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountIds":["id1","id2"]}'
```

### Troca de Email de Recuperação

```bash
curl -X POST http://localhost:3001/api/accounts/update-recovery-email \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountIds":["id1","id2"]}'
```

### Exportar Contas Prontas

```bash
curl -X POST http://localhost:3001/api/accounts/export-cookies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountIds":[]}'  # vazio = exporta todas
```
