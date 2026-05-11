/**
 * Gerador TOTP (RFC 6238) — sem dependências externas.
 * Usa apenas o módulo `crypto` nativo do Node.js.
 *
 * Compatível com Google Authenticator, Authy, etc.
 */

import { createHmac } from 'crypto';

// ── Base32 decoder ────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodifica uma string Base32 para um Buffer.
 * Aceita espaços, hifens e letras minúsculas (normaliza automaticamente).
 */
function base32Decode(input) {
  const str = input.replace(/\s|-/g, '').toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(Math.floor((str.length * 5) / 8));

  for (let i = 0; i < str.length; i++) {
    const charIdx = BASE32_CHARS.indexOf(str[i]);
    if (charIdx === -1) throw new Error(`Caractere inválido na chave TOTP: "${str[i]}"`);

    value = (value << 5) | charIdx;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  return Buffer.from(output.buffer, 0, index);
}

// ── HOTP (HMAC-based OTP) ─────────────────────────────────────

/**
 * Gera um código HOTP de 6 dígitos para um dado counter.
 * @param {Buffer} secretBytes - Chave secreta decodificada
 * @param {number} counter - Valor do contador (8 bytes big-endian)
 */
function hotp(secretBytes, counter) {
  // Converte counter para Buffer de 8 bytes big-endian
  const counterBuf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const hmac = createHmac('sha1', secretBytes).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}

// ── TOTP ──────────────────────────────────────────────────────

/**
 * Gera o código TOTP atual (30 segundos de janela) a partir de um segredo Base32.
 *
 * @param {string} secret - Chave secreta em Base32 (ex: "JBSWY3DPEHPK3PXP")
 * @param {Date} [at] - Momento para calcular (padrão: agora)
 * @returns {string} Código de 6 dígitos
 */
export function generateTOTP(secret, at = new Date()) {
  const secretBytes = base32Decode(secret);
  const counter = Math.floor(at.getTime() / 1000 / 30);
  return hotp(secretBytes, counter);
}

/**
 * Verifica se um código TOTP é válido, aceitando janela de ±1 período (30s).
 * Útil para debug.
 *
 * @param {string} secret
 * @param {string} code
 * @returns {boolean}
 */
export function verifyTOTP(secret, code) {
  const now = Date.now();
  for (const offset of [-1, 0, 1]) {
    const at = new Date(now + offset * 30_000);
    if (generateTOTP(secret, at) === code) return true;
  }
  return false;
}
