# 2FA TOTP — Geração, Detecção e Preenchimento

## Visão Geral

O sistema implementa TOTP (Time-based One-Time Password) conforme o **RFC 6238**, sem dependências externas. Tudo roda com o módulo `crypto` nativo do Node.js. O fluxo cobre três etapas:

1. Gerar o código de 6 dígitos a partir do segredo Base32
2. Detectar se a tela atual do Google exige um código TOTP
3. Preencher o campo e submeter

---

## 1. Geração do Token

**Arquivo:** `backend/src/totp.js`

### Pipeline interno

```
segredo Base32  →  base32Decode()  →  Buffer de bytes
                                           ↓
                                    hotp(secretBytes, counter)
                                           ↓
                                    código de 6 dígitos (string)
```

### Decodificação Base32

O segredo (ex: `JBSWY3DPEHPK3PXP`) é normalizado antes de decodificar:

- Espaços e hifens removidos
- Convertido para maiúsculas
- `=` de padding removido

Cada caractere Base32 representa 5 bits. A função acumula os bits e extrai bytes de 8 em 8.

### Geração HOTP

O contador é o timestamp Unix dividido por 30 (janela de 30 segundos):

```js
const counter = Math.floor(Date.now() / 1000 / 30);
```

O HMAC-SHA1 é calculado sobre o contador em 8 bytes big-endian usando o segredo como chave. Em seguida, aplica-se **dynamic truncation**:

```
offset  = hmac[último byte] & 0x0F
code    = 4 bytes a partir de hmac[offset], com MSB zerado
token   = code % 1_000_000  (6 dígitos, com padding de zeros à esquerda)
```

### Função pública

```js
import { generateTOTP } from './totp.js';

const code = generateTOTP('JBSWY3DPEHPK3PXP');
// => "482910"  (muda a cada 30s)
```

Aceita um segundo argumento `at: Date` para gerar códigos em outro instante (útil em testes):

```js
generateTOTP(secret, new Date('2026-01-01T00:00:00Z'));
```

### Verificação (±1 janela)

```js
import { verifyTOTP } from './totp.js';

verifyTOTP(secret, '482910'); // true/false
```

Aceita o código do período anterior e do seguinte para tolerar pequenas diferenças de relógio.

---

## 2. Detecção da Tela de TOTP

**Arquivo:** `backend/src/warmupEngine.js` — função `loginGoogle()`

A detecção é feita por três critérios combinados com `||`:

### 2.1 URL

```js
/challenge\/totp/i.test(currentUrl)
```

O Google redireciona para `/challenge/totp` quando exige o autenticador.

### 2.2 Texto da página

```js
/autenticador|authenticator|google authenticator|app de autenticação|
authentication app|insira.*código.*autenticador|enter.*code.*authenticator|
código.*6.*dígitos|6.digit.*code|insira.*código de 6/i.test(bodyText)
```

Cobre variações em português e inglês.

### 2.3 Elementos DOM

```js
await page.evaluate(() =>
  !!document.querySelector(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"]'
  )
)
```

Detecta o input de OTP pelo atributo HTML mesmo que o texto da página não bata.

### Resultado

```js
const isTOTPChallenge = urlMatch || textMatch || domMatch;
```

Essa variável é verificada no loop de segurança **antes** dos handlers genéricos de "skip", para não dispensar a tela acidentalmente.

---

## 3. Preenchimento do Campo

Quando `isTOTPChallenge === true` e `totpSecret` está preenchido na conta:

```js
const totpCode = generateTOTP(totpSecret);
```

### Seletor primário

```js
const codeInput = await page.waitForSelector(
  'input[type="tel"], input[type="number"], ' +
  'input[autocomplete="one-time-code"], input[inputmode="numeric"]',
  { visible: true, timeout: 8000 }
);

await codeInput.click({ clickCount: 3 }); // seleciona tudo
await codeInput.type(totpCode, { delay: TIMINGS.typingDelay });
await page.keyboard.press('Enter');
```

### Fallback (quando nenhum seletor bate)

Usa `page.evaluate()` para encontrar qualquer `<input>` visível que não seja senha nem email, e dispara eventos `input` e `change` manualmente:

```js
const inserted = await page.evaluate((code) => {
  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
  const vis = inputs.find(
    i => i.offsetParent !== null && i.type !== 'password' && i.type !== 'email'
  );
  if (!vis) return false;
  vis.focus();
  vis.value = '';
  for (const ch of code) {
    vis.value += ch;
    vis.dispatchEvent(new Event('input', { bubbles: true }));
  }
  vis.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, totpCode);
```

Após preencher, pressiona `Enter` e aguarda `4000ms` antes de continuar o loop de segurança.

### Caso sem segredo configurado

Se `isTOTPChallenge` for `true` mas `totpSecret` estiver vazio, o processo aborta com erro explícito:

```
2FA (autenticador) necessário e sem chave TOTP configurada
```

---

## 4. Fluxo no Contexto do Login

```
loginGoogle()
  └─ loop de segurança (até 15 rounds)
       ├─ isLoggedInUrl()  → encerra com sucesso
       ├─ CAPTCHA?         → aguarda resolução manual (5 min)
       │    └─ após resolver, verifica TOTP imediatamente
       ├─ Tela de challenge? + recoveryEmail → envia email de recuperação
       ├─ isTOTPChallenge?
       │    ├─ tem totpSecret → gera código, preenche, Enter → continue
       │    └─ não tem       → throw Error
       ├─ skip genérico (só se !isTOTPChallenge)
       └─ advance (só se !needsCode)
```

O TOTP é verificado **antes** do skip genérico para evitar que a tela seja descartada por engano.

---

## 5. Onde o `totpSecret` Vem

O campo `totpSecret` faz parte do objeto de conta armazenado em `data/store.json`:

```json
{
  "email": "conta@gmail.com",
  "password": "...",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "recoveryEmail": "backup@email.com"
}
```

É passado para `loginGoogle` em todos os pontos de chamada:

```js
await loginGoogle(
  page,
  account.email,
  account.password,
  log,
  account.recoveryEmail,
  account.totpSecret || ''   // ← 6º parâmetro
);
```

E também incluído no export de contas via `/accounts/export-cookies`.
