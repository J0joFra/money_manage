// Salvataggio locale (localStorage del browser). I dati non lasciano mai il dispositivo.

import { categorize } from './categories.js';

const KEY = 'spese.v1';

// balances: { [conto]: { date, booked, pending, available } } saldo letto dall'ultimo estratto conto
// notDuplicates: coppie di id "a|b" che l'utente ha indicato come movimenti diversi
// accounts: { [conto]: { iban } } i tuoi conti, per capire dove vanno i giroconti
const empty = () => ({ transactions: [], rules: [], balances: {}, notDuplicates: [], accounts: {}, settings: { ownNames: [] } });

export const CASH = 'Contanti';

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

let seq = 0;
export const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

export function applyCategory(t, state) {
  if (t.catSource === 'manuale') return t;
  if (t.linkedId && t.catSource === 'abbinato') return t;
  const ownIbans = Object.values(state.accounts || {}).map((a) => a.iban).filter(Boolean);
  const c = categorize(t, { ownNames: state.settings.ownNames, userRules: state.rules, ownIbans });
  return { ...t, category: c.category, subcategory: c.subcategory, catSource: c.source };
}

// Chiave per riconoscere lo stesso movimento importato da estratti diversi: conto + data + importo.
// Beneficiario e nota NON ne fanno parte perché cambiano da un formato all'altro
// (es. BBVA trimestrale "Ordine di pagamento" = esportazione app "REVOLUT JO").
export function dedupKey(t) {
  return [t.account, t.date, Number(t.amount).toFixed(2)].join('|');
}

// Beneficiari "generici" che vale la pena sostituire con quelli di un estratto più dettagliato
const GENERIC_PAYEE = /^(bonifico|ordine di pagamento|addebito diretto|pagamento carta|trasferimento|operazione)$/i;
const HAS_IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
// il nuovo movimento descrive meglio quello salvato? (beneficiario generico, oppure ora c'è anche l'IBAN)
const moreDetailed = (n, o) => (GENERIC_PAYEE.test(o.payee) && !GENERIC_PAYEE.test(n.payee)) ||
  (HAS_IBAN.test(n.note || '') && !HAS_IBAN.test(o.note || ''));

/**
 * Confronta i movimenti da importare con quelli salvati. Movimenti identici nello stesso estratto
 * (es. due caffè uguali lo stesso giorno) vengono contati: se ne aggiungono solo quelli in più.
 * Restituisce per ogni movimento il gemello già salvato (o null).
 */
export function matchExisting(state, txs) {
  const existing = new Map();
  for (const t of state.transactions) {
    const k = dedupKey(t);
    existing.set(k, [...(existing.get(k) || []), t]);
  }
  const seen = new Map();
  return txs.map((t) => {
    const k = dedupKey(t);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return (existing.get(k) || [])[n - 1] || null;
  });
}

/**
 * Aggiunge i movimenti nuovi e salta quelli già presenti. Di un movimento già presente:
 * - conferma quello "in sospeso" quando ricompare contabilizzato
 * - sostituisce un beneficiario generico con quello più dettagliato del nuovo estratto
 */
export function addTransactions(state, txs) {
  const twins = matchExisting(state, txs);
  let added = 0;
  let skipped = 0;
  let improved = 0;
  txs.forEach((t, i) => {
    const old = twins[i];
    if (!old) {
      state.transactions.push({ id: newId(), ...t });
      added++;
      return;
    }
    skipped++;
    if (!t.pending && old.pending) delete old.pending;
    if (t.counterIban && !old.counterIban) old.counterIban = t.counterIban; // reimportando si completano i collegamenti
    if (t.source && !old.source) old.source = t.source;
    if (moreDetailed(t, old)) {
      Object.assign(old, { payee: t.payee, note: t.note });
      Object.assign(old, applyCategory(old, state));
      improved++;
    }
  });
  state.transactions.sort((a, b) => b.date.localeCompare(a.date));
  return { added, skipped, improved };
}

/**
 * Possibili doppioni già salvati: stesso conto e stesso importo, date a pochi giorni di distanza,
 * provenienti da file diversi (o importati prima che l'app salvasse la provenienza).
 * Le coppie segnate come "non sono doppioni" vengono ignorate.
 */
export function findSavedDuplicates(state, maxDays = 3) {
  const ignored = new Set(state.notDuplicates || []);
  const groups = new Map();
  for (const t of state.transactions) {
    const k = `${t.account}|${Number(t.amount).toFixed(2)}`;
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  const pairs = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if ((Date.parse(b.date) - Date.parse(a.date)) / 86400000 > maxDays) break;
        if (used.has(a.id) || used.has(b.id)) continue;
        if (a.source && b.source && a.source === b.source) continue; // stesso estratto: movimenti distinti
        if (a.linkedId === b.id) continue;
        if (ignored.has([a.id, b.id].sort().join('|'))) continue;
        pairs.push([a, b]);
        used.add(a.id);
        used.add(b.id);
      }
    }
  }
  return pairs.sort((x, y) => y[0].date.localeCompare(x[0].date));
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

// ---------------------------------------------------------------------------
// Conti collegati: per ogni trasferimento capisce il conto di partenza e quello di arrivo.

const SAVINGS = 'Salvadanaio e conti deposito';

/** Il conto "dall'altra parte" di un trasferimento, oppure null se non si riesce a capirlo. */
export function counterpartAccount(t, state) {
  if (t.category !== 'Trasferimenti') return null;
  if (t.linkedId) {
    const other = state.transactions.find((x) => x.id === t.linkedId);
    if (other) return other.account;
  }
  if (t.subcategory === SAVINGS) return `${t.account} · salvadanaio`;
  if (/^conversione in [a-z]{3}\b|exchanged to/i.test(t.payee)) return `${t.account} · altre valute`;
  if (t.counterIban) {
    // IBAN mascherato (Satispay: "IT*****3385"): basta che coincidano paese e ultime cifre
    const masked = t.counterIban.match(/^([A-Z]{2})?\*+(\d+)$/);
    const same = (iban) => (masked ? iban.endsWith(masked[2]) && (!masked[1] || iban.startsWith(masked[1])) : iban === t.counterIban);
    const hit = Object.entries(state.accounts || {}).find(([name, a]) => a.iban && same(a.iban) && name !== t.account);
    if (hit) return hit[0];
  }
  if (t.subcategory === 'Prelievo contanti') return CASH;
  if (t.subcategory === 'Ricarica Satispay' && t.account !== 'Satispay') return 'Satispay';
  if (t.subcategory === 'Investimenti e risparmi' && /investiment/i.test(`${t.payee} ${t.note}`)) return `${t.account} · investimenti`;
  const text = `${t.payee} ${t.note}`;
  const byName = [['Revolut', /revolut/i], ['N26', /\bn26\b/i], ['BBVA', /\bbbva\b/i], ['Satispay', /satispay/i], ['PayPal', /paypal/i]]
    .find(([name, re]) => name !== t.account && re.test(text));
  if (byName) return byName[0];
  return null;
}

/**
 * Flussi di denaro tra i tuoi conti nel periodo: [{ from, to, amount, count }].
 * Per un giroconto abbinato conta un solo lato (l'uscita), così lo stesso denaro non vale doppio.
 */
export function accountFlows(state, inPeriod = () => true) {
  const flows = new Map();
  for (const t of state.transactions) {
    if (t.category !== 'Trasferimenti' || !inPeriod(t)) continue;
    if (t.amount > 0 && t.linkedId && state.transactions.some((x) => x.id === t.linkedId)) continue;
    const other = counterpartAccount(t, state) || 'Altro / sconosciuto';
    const [from, to] = t.amount < 0 ? [t.account, other] : [other, t.account];
    const k = `${from}→${to}`;
    const f = flows.get(k) || { from, to, amount: 0, count: 0 };
    f.amount += Math.abs(t.amount);
    f.count++;
    flows.set(k, f);
  }
  return [...flows.values()].sort((a, b) => b.amount - a.amount);
}

/** Saldo contanti: l'ultimo saldo impostato a mano + prelievi successivi + movimenti registrati sul conto Contanti. */
export function cashBalance(state) {
  const b = state.balances?.[CASH];
  if (!b) return null;
  const after = (t) => t.date > b.date || (t.date === b.date && (t.createdAt || 0) > (b.setAt || 0));
  const moves = state.transactions.filter((t) => t.account === CASH && after(t)).reduce((s, t) => s + t.amount, 0);
  const withdrawn = -state.transactions.filter((t) => t.subcategory === 'Prelievo contanti' && t.account !== CASH && after(t))
    .reduce((s, t) => s + t.amount, 0);
  return { ...b, available: b.available + moves + withdrawn, moves, withdrawn };
}
