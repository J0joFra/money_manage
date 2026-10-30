// Salvataggio locale (localStorage del browser). I dati non lasciano mai il dispositivo.

import { categorize } from './categories.js';

const KEY = 'spese.v1';

const empty = () => ({ transactions: [], rules: [], settings: { ownNames: [] } });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    return { ...empty(), ...data, settings: { ...empty().settings, ...data.settings } };
  } catch {
    return empty();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('Impossibile salvare i dati nel browser: ' + e.message);
    return false;
  }
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function dedupKey(t) {
  return [t.account, t.date, Number(t.amount).toFixed(2), norm(t.payee), norm(t.note)].join('|');
}

let seq = 0;
export const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

export function applyCategory(t, state) {
  if (t.catSource === 'manuale') return t;
  const c = categorize(t, { ownNames: state.settings.ownNames, userRules: state.rules });
  return { ...t, category: c.category, subcategory: c.subcategory, catSource: c.source };
}

/**
 * Aggiunge movimenti saltando i duplicati (stesso conto, data, importo, beneficiario, nota).
 * Movimenti identici nello stesso import (es. due caffè uguali lo stesso giorno) vengono tenuti entrambi.
 * Un movimento "in sospeso" già presente viene confermato quando ricompare.
 */
export function addTransactions(state, txs) {
  const existing = new Map();
  for (const t of state.transactions) {
    const k = dedupKey(t);
    existing.set(k, [...(existing.get(k) || []), t]);
  }
  const seen = new Map();
  let added = 0;
  let skipped = 0;
  for (const t of txs) {
    const k = dedupKey(t);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    const matches = existing.get(k) || [];
    if (matches.length >= n) {
      if (!t.pending && matches[n - 1].pending) delete matches[n - 1].pending;
      skipped++;
      continue;
    }
    state.transactions.push({ id: newId(), ...t });
    added++;
  }
  state.transactions.sort((a, b) => b.date.localeCompare(a.date));
  return { added, skipped };
}
