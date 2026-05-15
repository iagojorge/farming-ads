# Login Google — Fluxo de Confirmação por Email de Recuperação

## Contexto

Após digitar email e senha, o Google pode exibir uma tela de verificação de identidade pedindo que o usuário confirme via **email de recuperação** (também chamado de email secundário). O sistema detecta essa tela e a resolve automaticamente, sem intervenção humana.

---

## Onde isso acontece

**Arquivo:** `backend/src/warmupEngine.js`  
**Função:** `loginGoogle(page, email, password, log, recoveryEmail, totpSecret)`  
**Contexto:** Loop de segurança pós-login, que roda até 15 rounds.

---

## 1. Detecção da Tela de Verificação

A cada round do loop, duas condições são verificadas em conjunto:

### 1.1 URL contém `challenge`

```js
currentUrl.includes('challenge')
```

O Google redireciona para URLs do tipo:
- `accounts.google.com/signin/v2/challenge/selection`
- `accounts.google.com/signin/v2/challenge/ipp`
- `accounts.google.com/signin/v2/challenge/az`

Qualquer URL com a palavra `challenge` aciona a verificação.

### 1.2 Texto da página

```js
/confirme que é você|confirm it.?s you|본인 확인|verify.*identity|身份验证/i.test(bodyText)
```

Cobre as variantes em português, inglês, coreano e chinês que o Google usa na tela "Confirme que é você".

### Combinação

```js
const isChallengePage = currentUrl.includes('challenge') ||
  /confirme que é você|confirm it.?s you|.../i.test(bodyText);
```

O handler só é acionado se:
- `isChallengePage` for `true`
- `recoveryEmail` estiver preenchido na conta
- `recoveryEmailUsed` ainda for `false` (evita loop infinito)

```js
if (isChallengePage && recoveryEmail && !recoveryEmailUsed) { ... }
```

---

## 2. Seleção da Opção "Email de Recuperação"

Antes de digitar o email, o sistema precisa clicar na opção correta dentro da tela de escolha de método de verificação. São usadas **4 estratégias em cascata**, tentando a próxima apenas se a anterior falhar.

### Estratégia 1 — `data-challengetype="12"`

O Google usa o atributo `data-challengetype` para identificar o método. O valor `"12"` corresponde ao email de recuperação:

```js
const byType = document.querySelector('[data-challengetype="12"]');
if (byType) { byType.click(); return 'challengetype-12'; }
```

É a estratégia mais confiável pois usa um atributo HTML semântico, independente de idioma.

### Estratégia 2 — Texto mencionando "recuperação"

Se o atributo não estiver presente, busca por texto nos elementos clicáveis:

```js
/e-?mail.*recupera|recovery.*e-?mail|복구.*이메일|恢复.*邮件|recuperação|recovery/i.test(t)
```

Limita a `t.length < 200` para evitar clicar em blocos de texto grandes.

### Estratégia 3 — Domínio do email obfuscado

O Google exibe o email de recuperação parcialmente mascarado (ex: `b***@gmail.com`). A estratégia extrai o domínio do `recoveryEmail` configurado e procura um elemento que o contenha:

```js
const emailDomain = recoveryEmail.split('@')[1]; // ex: "gmail.com"
// busca elemento cujo texto inclua "gmail.com"
```

### Estratégia 4 — "Tentar de outra forma"

Se nenhuma opção de email aparecer diretamente, pode ser que esteja oculta atrás de um botão secundário. O sistema clica em:

```js
/tentar de outra forma/i, /try another way/i, /mais opções/i, ...
```

Aguarda 4 segundos e repete as estratégias 1 e 2 na nova tela.

---

## 3. Digitação do Email de Recuperação

Após selecionar a opção (ou se o campo já apareceu diretamente), o sistema preenche o input:

### Caminho primário

```js
const recInput = await page.waitForSelector(
  'input[type="email"], input[type="text"]',
  { visible: true, timeout: 10000 }
);
await recInput.click({ clickCount: 3 }); // seleciona tudo antes de digitar
await recInput.type(recoveryEmail, { delay: TIMINGS.typingDelay });
await page.keyboard.press('Enter');
recoveryEmailUsed = true;
```

### Fallback via `page.evaluate`

Se `waitForSelector` lançar timeout (campo tem outro tipo ou está em shadow DOM):

```js
const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
const visible = inputs.find(i => i.offsetParent !== null && i.type !== 'password');
// preenche caractere a caractere disparando eventos `input`
for (const ch of recEmail) {
  visible.value += ch;
  visible.dispatchEvent(new Event('input', { bubbles: true }));
}
```

O uso de `offsetParent !== null` garante que o input está visível na tela.

Após preencher, marca `recoveryEmailUsed = true` para não repetir o fluxo na próxima iteração do loop.

---

## 4. Fluxo Completo — Diagrama

```
Loop de segurança (round N)
  │
  ├─ URL tem "challenge" OU texto tem "Confirme que é você"?
  │    └─ NÃO → pula para próximo handler
  │
  ├─ recoveryEmail preenchido E ainda não usado?
  │    └─ NÃO → vai para handler de TOTP ou skip genérico
  │
  └─ SIM → tenta selecionar opção de email de recuperação
        │
        ├─ [E1] data-challengetype="12" existe? → clica
        ├─ [E2] texto "recovery/recuperação" existe? → clica
        ├─ [E3] domínio do recoveryEmail aparece na tela? → clica
        └─ [E4] botão "Tentar de outra forma" existe?
              └─ sim → clica → aguarda 4s → repete E1/E2
        │
        └─ Digita recoveryEmail no campo de input
              ├─ waitForSelector (primário)
              └─ page.evaluate fallback
              │
              └─ Enter → recoveryEmailUsed = true → continue
```

---

## 5. Por que `recoveryEmailUsed` existe

O flag evita que o sistema entre em loop caso o Google rejeite o email de recuperação (ex: digitou errado) ou exiba novamente a tela de challenge por outro motivo. Sem ele, o sistema tentaria o mesmo email indefinidamente a cada round.

---

## 6. Onde `recoveryEmail` vem

O campo faz parte do objeto de conta em `data/store.json`:

```json
{
  "email": "conta@gmail.com",
  "password": "...",
  "recoveryEmail": "backup@outlook.com",
  "totpSecret": "..."
}
```

É passado como 5º parâmetro para `loginGoogle` em todos os pontos de chamada:

```js
await loginGoogle(
  page,
  account.email,
  account.password,
  log,
  account.recoveryEmail,   // ← 5º parâmetro
  account.totpSecret || ''
);
```

Também é incluído no export de contas via `/accounts/export-cookies`.
