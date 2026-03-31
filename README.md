# 🌱 Farming Ads — Worker + Dashboard

Worker local que aquece contas do Google Ads via AdsPower / RPA Plus, com dashboard web para agendamento e monitoramento.

---

## Arquitetura

```
farming-ads/
├── backend/          # Node.js + Express — worker, scheduler, API REST
└── frontend/         # React + Vite + Tailwind — dashboard web
```

## Pré-requisitos

- Node.js ≥ 18
- AdsPower instalado e **aberto** na máquina local
- Fluxo RPA Plus já criado dentro do AdsPower (o processo de aquecimento)

---

## Instalação

```bash
# Na raiz do projeto
npm run install:all
```

---

## Configuração

1. Copie o arquivo de exemplo e ajuste conforme necessário:

```bash
copy backend\.env.example backend\.env
```

O arquivo `.env` é opcional — as configurações principais ficam no dashboard (aba **Configurações**).

---

## Rodando em desenvolvimento

```bash
npm run dev
```

Isso inicia:
- **Backend** → `http://localhost:3001`
- **Frontend** → `http://localhost:5173`

Abra o browser em `http://localhost:5173`.

---

## Fluxo de uso

### 1. Configurar (aba Configurações)
- **URL da API AdsPower**: padrão `http://local.adspower.net:50325`
- **API Key**: deixe em branco se não estiver habilitado no AdsPower
- **Modo RPA**:
  - `Auto (perfil)` → o fluxo já está configurado para iniciar automaticamente no perfil do AdsPower (recomendado)
  - `API` → o worker dispara o fluxo via API após abrir o browser (requer ID do fluxo)
- **Perfis simultâneos**: quantos browsers abrir ao mesmo tempo
- **Duração padrão**: minutos que cada browser fica aberto (pode ser sobrescrito por perfil)

### 2. Sincronizar perfis (aba Perfis)
Clique em **Sincronizar AdsPower** para importar os perfis cadastrados.  
Para cada perfil você pode:
- Habilitar/desabilitar com o toggle
- Definir duração individual
- Rodar manualmente com o botão **Rodar**

### 3. Agendar (aba Agenda)
Crie agendamentos com expressão cron. Exemplos de presets disponíveis:
- Todo dia às 09:00
- Seg–Sex às 13:00
- etc.

### 4. Monitorar (Dashboard + Logs)
O Dashboard exibe o status do worker em tempo real (via SSE), perfis ativos com contagem regressiva e atividade recente.

---

## Endpoints da API (backend)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/events` | SSE — status e logs em tempo real |
| GET/PUT | `/api/settings` | Configurações |
| GET | `/api/profiles` | Lista perfis salvos |
| POST | `/api/profiles/sync` | Re-sincroniza do AdsPower |
| PUT | `/api/profiles/:id` | Atualiza perfil (enabled, durationMinutes) |
| GET/POST | `/api/schedules` | Lista / cria agendamentos |
| PUT/DELETE | `/api/schedules/:id` | Atualiza / remove agendamento |
| GET | `/api/worker/status` | Status atual do worker |
| POST | `/api/worker/run` | Inicia execução (`{ profileIds?: string[] }`) |
| POST | `/api/worker/stop` | Para o worker |
| GET | `/api/logs` | Logs (`?limit=100&offset=0`) |
| DELETE | `/api/logs` | Limpa logs |

---

## Dados persistidos

Tudo fica em `backend/data/store.json` (JSON simples, sem banco de dados).

---

## Observações sobre o RPA Plus

- O processo (fluxo) de aquecimento deve ser criado **dentro do AdsPower → RPA Plus** antes de usar o worker.
- No modo `Auto`, basta configurar o fluxo para ser executado automaticamente ao iniciar o perfil nas configurações do perfil no AdsPower.
- No modo `API`, o endpoint `/api/v1/rpa/task/start` é chamado após o browser abrir — confirme que sua versão do AdsPower suporta esse endpoint.
