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
  if (t.linkedId && t.catSource === 'abbinato') return t;
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

// Categorie che possono essere "sostituite" da un giroconto riconosciuto per abbinamento
const pinned = (t) => t.catSource === 'manuale' || t.catSource === 'regola';
const LINKABLE = (t) => !pinned(t) &&
  (t.category === 'Trasferimenti' || t.category === 'Da categorizzare' || (t.category === 'Entrate' && t.subcategory === 'Altro'));

const DAY = 86400000;
const LINK_MAX_DAYS = 4;

/**
 * Riconosce i giroconti abbinando un'uscita su un conto con un'entrata dello stesso importo
 * su un altro conto entro pochi giorni (es. BBVA -1000 "TRASF" -> Revolut +1000).
 * Entrambi i movimenti diventano Trasferimenti e vengono collegati tra loro (linkedId).
 */
export function linkTransfers(state) {
  const txs = state.transactions;
  const byId = new Map(txs.map((t) => [t.id, t]));
  // scollega abbinamenti non più validi (movimento cancellato o ricategorizzato a mano)
  const broken = txs.filter((t) => {
    if (!t.linkedId) return false;
    const other = byId.get(t.linkedId);
    return !other || other.linkedId !== t.id || pinned(t) || pinned(other);
  });
  for (const t of broken) {
    delete t.linkedId;
    if (t.catSource === 'abbinato') Object.assign(t, applyCategory({ ...t, catSource: 'auto' }, state));
  }
  const incoming = txs.filter((t) => t.amount > 0 && !t.linkedId && LINKABLE(t));
  for (const out of txs) {
    if (out.amount >= 0 || out.linkedId || !LINKABLE(out)) continue;
    const d = Date.parse(out.date);
    let best = null;
    for (const inc of incoming) {
      if (inc.linkedId || inc.account === out.account || Math.abs(inc.amount + out.amount) > 0.005) continue;
      const diff = Math.abs(Date.parse(inc.date) - d) / DAY;
      if (diff <= LINK_MAX_DAYS && (!best || diff < best.diff)) best = { inc, diff };
    }
    if (!best) continue;
    const { inc } = best;
    out.linkedId = inc.id;
    inc.linkedId = out.id;
    for (const t of [out, inc]) {
      // mantieni la sottocategoria se era già un trasferimento (es. Ricarica Satispay)
      if (t.category !== 'Trasferimenti') Object.assign(t, { category: 'Trasferimenti', subcategory: 'Giroconto tra miei conti' });
      t.catSource = 'abbinato';
    }
  }
}
