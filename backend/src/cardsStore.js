import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const CARDS_FILE = join(DATA_DIR, 'cards.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readCards() {
  ensureDir();
  if (!existsSync(CARDS_FILE)) return [];
  const raw = JSON.parse(readFileSync(CARDS_FILE, 'utf-8'));
  // Migração: garantir que todos os cartões tenham id
  let changed = false;
  for (const c of raw) {
    if (!c.id) {
      c.id = randomBytes(6).toString('hex');
      changed = true;
    }
  }
  if (changed) writeFileSync(CARDS_FILE, JSON.stringify(raw, null, 2));
  return raw;
}

function writeCards(cards) {
  ensureDir();
  writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
}

export function listCards() {
  return readCards();
}

export function createCard(data) {
  const cards = readCards();
  const card = {
    id: randomBytes(6).toString('hex'),
    bandeira: data.bandeira || 'Visa',
    moeda: data.moeda || 'USD',
    numero_cartao: data.numero_cartao,
    validade: data.validade,
    cvc: data.cvc,
    status: data.status || 'Ativado',
    usado: false,
  };
  cards.push(card);
  writeCards(cards);
  return card;
}

export function removeCard(id) {
  const cards = readCards();
  const idx = cards.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const [removed] = cards.splice(idx, 1);
  writeCards(cards);
  return removed;
}
