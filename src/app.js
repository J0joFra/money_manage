import * as pdfjs from '../vendor/pdf.min.mjs';
import { extractLines } from './pdf-text.js';
import { parseStatement, PARSERS } from './parsers/index.js';
import { parseCsv, toCsv } from './csv.js';
import { CATEGORIES, categoryType } from './categories.js';
import { load, save, addTransactions, applyCategory, linkTransfers, matchExisting, findSavedDuplicates, newId,
  CASH, cashBalance, accountFlows, counterpartAccount } from './store.js';

// Aggiornare anche version.json: se il browser ha in cache una versione vecchia compare un avviso
export const VERSION = '2026-10-30.8';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

let state = load();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n, cur = 'EUR') => new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur }).format(n + 0); // + 0 evita "-0,00 €"
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const persist = () => save(state);

// ---------- tab ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  showTab(b.dataset.tab);
});
function showTab(id) {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === id));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + id));
  render();
}

// ---------- select categorie ----------
function categoryOptions(selected) {
  return CATEGORIES.map((c) => `<optgroup label="${esc(c.icon + ' ' + c.name)}">${c.subs
    .map((s) => {
      const v = `${c.name}|${s}`;
      return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(c.name)} › ${esc(s)}</option>`;
    }).join('')}</optgroup>`).join('');
}

// ---------- helpers ----------
const months = () => [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
const accounts = () => [...new Set(state.transactions.map((t) => t.account).filter(Boolean))].sort();

function fillSelect(sel, options, keep = true) {
  const prev = sel.value;
  sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  if (keep && options.some(([v]) => v === prev)) sel.value = prev;
}

function periodOptions() {
  const ms = months();
  const years = [...new Set(ms.map((m) => m.slice(0, 4)))];
  return [['', 'Tutto'], ...ms.map((m) => [m, monthLabel(m)]), ...years.map((y) => [y, `Anno ${y}`])];
}

const inPeriod = (t, p) => !p || t.date.startsWith(p);

// ---------- RIEPILOGO ----------
let expandedCat = null;
let periodInitialized = false;

function renderSummary() {
  const psel = $('#sum-period');
  fillSelect(psel, periodOptions());
  // al primo avvio con dati mostra l'ultimo mese
  if (!periodInitialized && months().length) { psel.value = months()[0]; periodInitialized = true; }
  fillSelect($('#sum-account'), [['', 'Tutti i conti'], ...accounts().map((a) => [a, a])]);
  const period = psel.value;
  const account = $('#sum-account').value;

  const base = state.transactions.filter((t) => !account || t.account === account);
  const txs = base.filter((t) => inPeriod(t, period));
  const type = (t) => categoryType(t.category);
  const expenses = txs.filter((t) => type(t) === 'expense');
  const spent = -expenses.reduce((s, t) => s + t.amount, 0);
  const income = txs.filter((t) => type(t) === 'income').reduce((s, t) => s + t.amount, 0);
  const uncategorized = txs.filter((t) => t.category === 'Da categorizzare').length;

  if (!state.transactions.length) {
    $('#sum-tiles').innerHTML = '';
    $('#sum-cats').innerHTML = `<div class="empty">Nessun movimento. <button class="link" data-go="import">Importa un estratto conto</button></div>`;
    $('#sum-trend').innerHTML = '';
    $('#sum-payees').innerHTML = '';
    return;
  }

  renderBalances();
  $('#sum-tiles').innerHTML = [
    ['Spese', eur(spent), 'neg'],
    ['Entrate', eur(income), 'pos'],
    ['Differenza', eur(income - spent), income - spent >= 0 ? 'pos' : 'neg'],
    ['Da categorizzare', uncategorized ? `<button class="link" data-go="list" data-cat="Da categorizzare">${uncategorized} movimenti</button>` : '0', ''],
  ].map(([k, v, c]) => `<div class="tile"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`).join('');

  renderTransfers(txs, period);

  // per categoria
  const byCat = new Map();
  for (const t of expenses) {
    const c = byCat.get(t.category) || { total: 0, subs: new Map() };
    c.total -= t.amount;
    c.subs.set(t.subcategory, (c.subs.get(t.subcategory) || 0) - t.amount);
    byCat.set(t.category, c);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total);
  const max = cats[0]?.[1].total || 1;
  const icon = (n) => CATEGORIES.find((c) => c.name === n)?.icon || '';
  const row = (name, val, cls = '', attrs = '') =>
    `<div class="bar-row ${cls}" ${attrs} title="${esc(name)}: ${eur(val)}">
      <span class="name">${name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(val / max) * 100}%"></div></div>
      <span class="val">${eur(val)}<span class="pct">${spent ? Math.round((val / spent) * 100) : 0}%</span></span></div>`;
  $('#sum-cats').innerHTML = cats.length
    ? `<div class="bars">${cats.map(([name, c]) => row(`${icon(name)} ${esc(name)}`, c.total, '', `data-cat="${esc(name)}"`) +
        (expandedCat === name
          ? [...c.subs.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => row(esc(s), v, 'sub')).join('') +
            `<div class="bar-row sub" style="display:block"><button class="link" data-go="list" data-cat="${esc(name)}">Vedi i movimenti →</button></div>`
          : '')).join('')}</div>`
    : '<div class="empty">Nessuna spesa nel periodo</div>';

  // andamento ultimi 12 mesi
  const last = months().slice(0, 12).reverse();
  const monthly = last.map((m) => -base.filter((t) => t.date.startsWith(m) && type(t) === 'expense').reduce((s, t) => s + t.amount, 0));
  const mmax = Math.max(...monthly, 1);
  $('#sum-trend').innerHTML = `<div class="trend">${last.map((m, i) =>
    `<div class="col${m === period ? ' sel' : ''}" data-month="${m}"><span class="tip">${monthLabel(m)}: ${eur(monthly[i])}</span>
      <div class="c" style="height:${(monthly[i] / mmax) * 100}%"></div></div>`).join('')}</div>
    <div class="trend-labels">${last.map((m) => `<span>${MONTHS[Number(m.slice(5)) - 1]}</span>`).join('')}</div>`;

  // top beneficiari
  const byPayee = new Map();
  for (const t of expenses) byPayee.set(t.payee, (byPayee.get(t.payee) || 0) - t.amount);
  const top = [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  $('#sum-payees').innerHTML = `<table class="tx">${top.map(([p, v]) => `<tr><td>${esc(p)}</td><td class="num">${eur(v)}</td></tr>`).join('')}</table>`;
}

// Saldo di ogni conto: quello dell'ultimo estratto con saldo, più i movimenti importati con data successiva
// (es. BBVA: saldo del trimestrale al 01/10 + movimenti di ottobre dall'esportazione "Ultimi movimenti")
function currentBalances() {
  // tutti i conti: quelli con un saldo (da estratto o impostato a mano) e quelli con movimenti importati
  const names = [...new Set([...Object.keys(state.balances || {}), ...accounts()])]
    .filter((n) => !n.includes(' · ') && (n !== CASH || state.balances?.[CASH]))
    .sort((a, b) => (a === CASH) - (b === CASH) || a.localeCompare(b));
  const list = names.map((acc) => {
    const b = state.balances?.[acc];
    if (acc === CASH) return [acc, { ...cashBalance(state), cash: true }];
    if (!b) {
      // nessun estratto con il saldo (es. BBVA "Ultimi movimenti"): somma di tutti i movimenti importati,
      // giusta se hai importato la storia del conto dall'apertura
      const txs = state.transactions.filter((t) => t.account === acc);
      const last = txs.reduce((d, t) => (t.date > d ? t.date : d), '');
      const first = txs.reduce((d, t) => (!d || t.date < d ? t.date : d), '');
      return [acc, { available: txs.reduce((s, t) => s + t.amount, 0), date: last, estimated: true, from: first }];
    }
    const later = state.transactions.filter((t) => t.account === acc && b.date && t.date > b.date);
    const delta = later.reduce((s, t) => s + t.amount, 0);
    const last = later.reduce((d, t) => (t.date > d ? t.date : d), b.date || '');
    return [acc, { ...b, available: b.available + delta, date: last, rolled: later.length, from: b.date }];
  });
  // "tasche" di un conto (salvadanaio, investimenti, altre valute): soldi spostati dentro meno soldi ripresi.
  // Se ne imposti il valore a mano (es. investimenti che cambiano valore) si parte da quello.
  const out = [];
  for (const entry of list) {
    out.push(entry);
    const [acc] = entry;
    const pockets = new Map();
    for (const t of state.transactions) {
      if (t.account !== acc || t.category !== 'Trasferimenti') continue;
      const other = counterpartAccount(t, state);
      if (other && other.startsWith(`${acc} · `)) pockets.set(other, [...(pockets.get(other) || []), t]);
    }
    for (const name of Object.keys(state.balances || {})) if (name.startsWith(`${acc} · `) && !pockets.has(name)) pockets.set(name, []);
    for (const [name, moves] of pockets) {
      const manual = state.balances?.[name];
      const counted = manual ? moves.filter((t) => t.date > manual.date) : moves;
      const value = (manual ? manual.available : 0) - counted.reduce((s, t) => s + t.amount, 0);
      // senza un valore impostato a mano, una tasca "in negativo" vuol dire che manca l'origine dei soldi
      if (!manual && value < 0.005) continue;
      const last = counted.reduce((d, t) => (t.date > d ? t.date : d), manual?.date || '');
      out.push([name, { available: value, date: last, pocket: true, manual: !!manual, from: manual?.date }]);
    }
  }
  return out;
}

function renderBalances() {
  const entries = currentBalances();
  const box = $('#sum-balances');
  if (!entries.length) { box.innerHTML = ''; return; }
  const total = entries.reduce((s, [, b]) => s + b.available, 0);
  box.innerHTML = `<div class="tiles">${entries.map(([acc, b]) =>
    `<div class="tile"><div class="k">${esc(acc)}${b.date ? ` · al ${b.date.slice(8)}/${b.date.slice(5, 7)}/${b.date.slice(0, 4)}` : ''}</div>
      <div class="v">${eur(b.available)}</div>
      ${b.pending && !b.rolled ? `<div class="muted">contabile ${eur(b.booked)} · in sospeso ${eur(b.pending)}</div>` : ''}
      ${b.pocket ? `<div class="muted">${b.manual ? `valore impostato al ${b.from.slice(8)}/${b.from.slice(5, 7)}${b.date !== b.from ? ' + trasferimenti successivi' : ''}` : 'soldi spostati dentro meno quelli ripresi'}</div>
        <button class="link" data-setbal="${esc(acc)}">${/investiment/.test(acc) ? 'Aggiorna valore' : 'Imposta saldo esatto'}</button>` : ''}
      ${b.estimated ? `<div class="muted">somma dei movimenti importati dal ${b.from.slice(8)}/${b.from.slice(5, 7)}/${b.from.slice(0, 4)} (giusta se parti dall'apertura del conto)</div>
        <button class="link" data-setbal="${esc(acc)}">Imposta saldo esatto</button>` : ''}
      ${b.rolled ? `<div class="muted">saldo ${b.manual ? 'impostato' : 'estratto'} al ${b.from.slice(8)}/${b.from.slice(5, 7)} + ${b.rolled} movimenti successivi</div>` : ''}
      ${b.manual && !b.cash && !b.pocket ? `<button class="link" data-setbal="${esc(acc)}">Aggiorna saldo</button>` : ''}
      ${b.cash ? `<div class="muted">${b.withdrawn ? `+ prelievi ${eur(b.withdrawn)} ` : ''}${b.moves ? `${b.moves < 0 ? '−' : '+'} spese registrate ${eur(Math.abs(b.moves))}` : ''}</div>
        <button class="link" data-setbal="${esc(acc)}">Aggiorna saldo</button>` : ''}</div>`).join('')}
    ${state.balances?.[CASH] ? '' : `<div class="tile"><div class="k">💵 Contanti</div><div class="v muted">—</div><button class="link" data-setbal="${CASH}">Imposta saldo contanti</button></div>`}
    <div class="tile"><div class="k">Altro conto</div><div class="muted">PayPal, buoni pasto, investimenti… senza estratto conto</div>
      <button class="link" data-setbal="">+ Aggiungi con saldo</button></div>
    <div class="tile"><div class="k">Totale conti</div><div class="v">${eur(total)}</div></div></div>`;
}

// ---------- saldo impostato a mano (contanti, o conti senza estratto come PayPal) ----------
document.addEventListener('click', (e) => {
  const acc = e.target.closest('[data-setbal]')?.dataset.setbal;
  if (acc != null) setBalanceDialog(acc);
});

function setBalanceDialog(acc) {
  const isCash = acc === CASH;
  const isNew = !acc;
  const isPocket = acc.includes(' · ');
  const current = isNew ? null : isCash ? cashBalance(state) : currentBalances().find(([a]) => a === acc)?.[1];
  const today = new Date().toISOString().slice(0, 10);
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog">
    <h2>${isCash ? '💵 Saldo contanti' : isNew ? 'Aggiungi un conto' : `Saldo ${esc(acc)}`}</h2>
    ${isNew ? `<label>Nome del conto<input name="name" required placeholder="es. PayPal" list="acc-names"><datalist id="acc-names">${['PayPal', 'Revolut · investimenti', 'BBVA · salvadanaio'].map((n) => `<option value="${n}">`).join('')}</datalist></label>
      <p class="hint">Per una "tasca" di un conto usa il formato <i>Conto · nome</i> (es. Revolut · investimenti).</p>` : ''}
    ${current ? `<p class="hint">Saldo calcolato ora: <b>${eur(current.available)}</b></p>` : ''}
    <label>Quanto hai ${isCash ? 'in contanti' : 'sul conto'} oggi?<input name="amount" type="number" step="0.01" required value="${current ? current.available.toFixed(2) : ''}"></label>
    <label>Alla data<input name="date" type="date" value="${today}" required></label>
    ${current && !isPocket ? `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="diff"${isCash ? ' checked' : ''}>
      Registra la differenza come movimento (es. spese in contanti che non hai segnato)</label>` : ''}
    <div class="toolbar"><button value="ok">Salva</button><button value="cancel" class="secondary" formnovalidate>Annulla</button></div>
  </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const f = Object.fromEntries(new FormData(dlg.querySelector('form')));
    const amount = Number(f.amount);
    if (Number.isNaN(amount)) return;
    if (isNew) acc = f.name.trim().replace(/\s*·\s*/g, ' · ');
    if (!acc) return;
    const diff = current ? Math.round((amount - current.available) * 100) / 100 : 0;
    if (f.diff && diff) {
      state.transactions.push(applyCategory({
        id: newId(), createdAt: Date.now(), date: f.date, amount: diff, currency: 'EUR', account: acc,
        payee: diff < 0 ? (isCash ? 'Spese in contanti non registrate' : 'Differenza saldo') : 'Differenza saldo (in più)',
        note: `Allineamento saldo a ${eur(amount)}`,
      }, state));
      state.transactions.sort((a, b) => b.date.localeCompare(a.date));
    }
    state.balances[acc] = { date: f.date, booked: amount, pending: 0, available: amount, manual: true, setAt: Date.now() };
    if (!acc.includes(' · ')) state.accounts[acc] = state.accounts[acc] || {};
    persist();
    render();
  };
  dlg.showModal();
}

// Soldi spostati tra i tuoi conti e contanti
function renderTransfers(txs, period) {
  const transfers = txs.filter((t) => categoryType(t.category) === 'transfer');
  const groups = [
    ['Giroconti tra i tuoi conti', 'Giroconto tra miei conti'],
    ['Ricariche Satispay', 'Ricarica Satispay'],
    ['Salvadanai e conti deposito (netto)', 'Salvadanaio e conti deposito'],
    ['Verso risparmi e investimenti', 'Investimenti e risparmi'],
    ['Prelievi di contanti', 'Prelievo contanti'],
    ['Altri trasferimenti', 'Altro'],
  ];
  const rows = groups.map(([label, sub]) => {
    const list = transfers.filter((t) => t.subcategory === sub);
    // per giroconti e ricariche conta solo il lato in uscita (l'entrata è lo stesso denaro)
    const moved = sub === 'Investimenti e risparmi' || sub === 'Salvadanaio e conti deposito'
      ? -list.reduce((s, t) => s + t.amount, 0)
      : -list.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0) || list.reduce((s, t) => s + t.amount, 0);
    return list.length ? `<tr><td>${label}<div class="muted">${list.length} moviment${list.length === 1 ? 'o' : 'i'}</div></td><td class="num">${eur(moved)}</td></tr>` : '';
  }).join('');

  $('#sum-transfers').innerHTML = (rows ? `<table class="tx">${rows}</table>` : '<p class="hint">Nessun trasferimento nel periodo.</p>') +
    '<p class="hint" style="margin-top:10px"><button class="link" data-go="accounts">Vedi da quale conto a quale →</button></p>';
}

$('#sum-period').addEventListener('change', renderSummary);
$('#sum-account').addEventListener('change', renderSummary);
$('#sum-cats').addEventListener('click', (e) => {
  const r = e.target.closest('.bar-row[data-cat]');
  if (!r) return;
  expandedCat = expandedCat === r.dataset.cat ? null : r.dataset.cat;
  renderSummary();
});
$('#sum-trend').addEventListener('click', (e) => {
  const c = e.target.closest('[data-month]');
  if (c) { $('#sum-period').value = c.dataset.month; renderSummary(); }
});
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  if (go.dataset.go === 'list') {
    renderListFilters();
    $('#f-category').value = go.dataset.cat || '';
    $('#f-period').value = go.dataset.cat === 'Da categorizzare' ? '' : $('#sum-period').value;
    $('#f-account').value = $('#sum-account').value;
  }
  showTab(go.dataset.go);
});

// ---------- MOVIMENTI ----------
function renderListFilters() {
  fillSelect($('#f-period'), periodOptions());
  fillSelect($('#f-account'), [['', 'Tutti i conti'], ...accounts().map((a) => [a, a])]);
  fillSelect($('#f-category'), [['', 'Tutte le categorie'], ...CATEGORIES.map((c) => [c.name, `${c.icon} ${c.name}`])]);
}

function filteredList() {
  const q = $('#f-search').value.trim().toLowerCase();
  const p = $('#f-period').value;
  const a = $('#f-account').value;
  const c = $('#f-category').value;
  return state.transactions.filter((t) => inPeriod(t, p) && (!a || t.account === a) && (!c || t.category === c) &&
    (!q || `${t.payee} ${t.note}`.toLowerCase().includes(q)));
}

function txRow(t, { editable = true, twin = null } = {}) {
  const transfer = categoryType(t.category) === 'transfer';
  return `<tr data-id="${t.id}" class="${transfer ? 'transfer' : ''}${twin ? ' dup' : ''}">
    <td class="date">${t.date.slice(8)}/${t.date.slice(5, 7)}<div class="muted">${t.date.slice(0, 4)}</div></td>
    <td><span class="payee">${esc(t.payee)}</span>${t.pending ? '<span class="tag">in sospeso</span>' : ''}${twin ? `<span class="tag">già presente${twin.payee !== t.payee ? ` come «${esc(twin.payee)}»` : ''}</span>` : ''}
      <div class="muted">${esc(t.note)}${t.account ? ' · ' + esc(t.account) : ''}</div></td>
    <td><select data-act="cat">${categoryOptions(`${t.category}|${t.subcategory}`)}</select>
      ${t.catSource === 'manuale' ? '' : `<div class="muted">${catSourceLabel(t)}</div>`}</td>
    <td class="num ${t.amount < 0 ? 'neg' : 'pos'}">${eur(t.amount, t.currency)}</td>
    ${editable ? `<td><button class="link" data-act="del" title="Elimina">✕</button></td>` : ''}
  </tr>`;
}

function catSourceLabel(t) {
  if (t.catSource === 'regola') return 'da tua regola';
  if (t.catSource === 'abbinato') {
    const other = state.transactions.find((x) => x.id === t.linkedId);
    return other ? `↔ ${t.amount < 0 ? 'verso' : 'da'} ${esc(other.account)} (${other.date.slice(8)}/${other.date.slice(5, 7)})` : 'giroconto';
  }
  return 'automatica';
}

// ---------- OVERVIEW: tabella mese per mese ----------
const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2).replace('.', ',')}%`);

// Saldo di tutti i conti alla fine di un giorno: saldo di oggi meno i movimenti successivi.
// Un conto conta solo da quando ne hai importato lo storico (prima non si può sapere quanto c'era).
function totalBalanceAt(endDate, balances) {
  let total = 0;
  const missing = [];
  for (const [acc, b] of balances) {
    if (/investiment/i.test(acc)) continue; // il saldo è la liquidità: gli investimenti non contano
    if (b.pocket) {
      // tasca: i trasferimenti verso la tasca sono uscite sul conto principale
      const parent = acc.split(' · ')[0];
      const after = state.transactions.filter((t) => t.account === parent && t.date > endDate && counterpartAccount(t, state) === acc);
      total += b.available + after.reduce((s, t) => s + t.amount, 0);
    } else if (b.cash) {
      if (b.date && endDate < b.date) continue; // prima che impostassi il saldo contanti non lo conosciamo
      total += b.available;
    } else {
      const own = state.transactions.filter((t) => t.account === acc);
      const first = own.reduce((d, t) => (!d || t.date < d ? t.date : d), '');
      if (!first || endDate < first.slice(0, 7) + '-01') { if (!b.manual) missing.push(acc); continue; }
      const after = own.filter((t) => t.date > endDate);
      total += b.available - after.reduce((s, t) => s + t.amount, 0);
    }
  }
  return { total, missing };
}

// Obiettivi di saldo per anno ({ "2026": 5000 }); converte quelli per mese della versione precedente
function yearGoals() {
  if (!state.yearGoals) {
    state.yearGoals = {};
    for (const [ym, v] of Object.entries(state.goals || {}).sort()) state.yearGoals[ym.slice(0, 4)] = v;
  }
  return state.yearGoals;
}

function monthlyOverview() {
  const minSaving = state.settings.minSaving ?? 0.2;
  const byMonth = new Map();
  for (const t of state.transactions) {
    const ym = t.date.slice(0, 7);
    const m = byMonth.get(ym) || { ym, income: 0, expenses: 0, salary: 0, invested: 0 };
    const type = categoryType(t.category);
    if (type === 'income') m.income += t.amount;
    if (type === 'expense') m.expenses -= t.amount;
    if (t.subcategory === 'Stipendio') m.salary += t.amount;
    // il salvadanaio è una parte del conto (soldi messi da parte), non un investimento
    if (t.subcategory === 'Investimenti e risparmi') m.invested -= t.amount;
    byMonth.set(ym, m);
  }
  const months = [...byMonth.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  const balances = currentBalances();
  let cumulative = 0;
  let prev = null;
  for (const m of months) {
    m.total = m.income - m.expenses;
    // con entrate quasi nulle (es. 0,03 € di interessi) la percentuale non ha senso
    m.savingRate = m.income >= 1 ? m.total / m.income : null;
    m.trend = prev && prev.expenses ? (m.expenses - prev.expenses) / prev.expenses : null;
    cumulative += m.total;
    m.cumulative = cumulative;
    m.salaryShare = m.salary ? m.expenses / m.salary : null;
    m.minOk = m.savingRate != null && m.savingRate >= minSaving;
    const bal = balances.length ? totalBalanceAt(`${m.ym}-31`, balances) : null;
    m.balance = bal?.total ?? null;
    m.balanceMissing = bal?.missing || [];
    m.goal = yearGoals()[m.ym.slice(0, 4)] ?? null;
    m.goalReached = m.goal != null && m.balance != null ? m.balance >= m.goal : null;
    prev = m;
  }
  return months.reverse();
}

function renderOverview() {
  $('#ov-min').value = Math.round((state.settings.minSaving ?? 0.2) * 100);
  const months = monthlyOverview();
  const head = ['Data', 'Entrate', 'Uscite', 'Totale', 'Risparmio %', 'Salario', 'Trend mensile %', 'Saldo cumulativo',
    'Incidenza Salario %', 'Risparmio minimo', 'Saldo', 'Obiettivo', 'Investimento'];
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const yesNo = (v, yes = 'Sì', no = 'No') => (v == null ? '—' : `<span class="badge ${v ? 'ok' : 'ko'}">${v ? yes : no}</span>`);
  const row = (m) => `<tr data-month="${m.ym}" class="${$('#f-period').value === m.ym ? 'sel' : ''}">
    <td class="date">${MONTH_NAMES[Number(m.ym.slice(5)) - 1]} ${m.ym.slice(0, 4)}</td>
    <td class="num pos">${eur(m.income)}</td>
    <td class="num neg">${eur(m.expenses)}</td>
    <td class="num ${cls(m.total)}">${eur(m.total)}</td>
    <td class="num ${cls(m.savingRate)}">${pct(m.savingRate)}</td>
    <td class="num">${m.salary ? eur(m.salary) : '—'}</td>
    <td class="num ${m.trend == null ? '' : m.trend > 0 ? 'neg' : 'pos'}">${m.trend == null ? '—' : (m.trend > 0 ? '+' : '') + pct(m.trend)}</td>
    <td class="num ${cls(m.cumulative)}">${eur(m.cumulative)}</td>
    <td class="num">${pct(m.salaryShare)}</td>
    <td>${m.savingRate == null ? '—' : yesNo(m.minOk, 'Ok', 'No')}</td>
    <td class="num"${m.balanceMissing.length ? ` title="Esclusi (storico non importato): ${esc(m.balanceMissing.join(', '))}"` : ''}>${m.balance == null ? '—' : eur(m.balance)}${m.balanceMissing.length ? '<sup>*</sup>' : ''}</td>
    <td>${yesNo(m.goalReached)}</td>
    <td>${m.invested > 0.005 ? `<span class="badge ok">Sì</span> <span class="muted">${eur(m.invested)}</span>` : '<span class="badge ko">No</span>'}</td>
  </tr>`;
  // raggruppato per anno, con una riga di totale per anno
  const years = [...new Set(months.map((m) => m.ym.slice(0, 4)))];
  fillSelect($('#ov-year'), years.map((y) => [y, y]));
  const y = $('#ov-year').value;
  $('#ov-goal-year').textContent = y;
  document.querySelectorAll('.ov-y').forEach((el) => (el.textContent = y));
  $('#ov-goal').value = yearGoals()[y] ?? '';
  $('#ov-table').innerHTML = months.length ? `<thead><tr>${head.map((h, i) => `<th${i && i !== 9 && i !== 12 ? ' style="text-align:right"' : ''}>${h}</th>`).join('')}</tr></thead>
    ${[y].map((y) => {
      const ms = months.filter((m) => m.ym.startsWith(y));
      const inc = ms.reduce((s, m) => s + m.income, 0);
      const exp = ms.reduce((s, m) => s + m.expenses, 0);
      const sal = ms.reduce((s, m) => s + m.salary, 0);
      const inv = ms.reduce((s, m) => s + m.invested, 0);
      return `<tbody><tr class="year"><td>${y}</td><td class="num pos">${eur(inc)}</td><td class="num neg">${eur(exp)}</td>
        <td class="num ${cls(inc - exp)}">${eur(inc - exp)}</td><td class="num">${pct(inc ? (inc - exp) / inc : null)}</td>
        <td class="num">${sal ? eur(sal) : '—'}</td><td></td><td class="num">${eur(ms[0].cumulative)}</td>
        <td class="num">${pct(sal ? exp / sal : null)}</td><td></td><td class="num">${ms[0].balance == null ? '—' : eur(ms[0].balance)}</td>
        <td class="num">${ms[0].goal == null ? '—' : eur(ms[0].goal)}</td>
        <td class="num">${inv > 0.005 ? eur(inv) : ''}</td></tr>${ms.map(row).join('')}</tbody>`;
    }).join('')}` : '<tr><td class="empty">Nessun movimento importato</td></tr>';
}

$('#ov-year').addEventListener('change', renderOverview);

// CSV dell'anno scelto: i movimenti (stesso formato dell'export) e la tabella mese per mese
$('#ov-csv-tx').addEventListener('click', () => {
  const y = $('#ov-year').value;
  const txs = state.transactions.filter((t) => t.date.startsWith(y)).sort((a, b) => a.date.localeCompare(b.date));
  download(`movimenti_${y}.csv`, toCsv(txs), 'text/csv');
});
$('#ov-csv-table').addEventListener('click', () => {
  const y = $('#ov-year').value;
  // formato per Excel in italiano: separatore ";" e virgola decimale
  const num = (v) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(2).replace('.', ','));
  const rate = (v) => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toFixed(2).replace('.', ',')}%`);
  const months = monthlyOverview().filter((m) => m.ym.startsWith(y));
  const head = ['Data', 'Entrate', 'Uscite', 'Totale', 'Risparmio %', 'Salario', 'Trend mensile %', 'Saldo cumulativo',
    'Incidenza Salario %', 'Risparmio minimo', 'Saldo', 'Obiettivo raggiunto', 'Investimento'];
  const rows = months.map((m) => [
    `${MONTH_NAMES[Number(m.ym.slice(5)) - 1]} ${y}`, num(m.income), num(m.expenses), num(m.total), rate(m.savingRate), num(m.salary),
    rate(m.trend), num(m.cumulative), rate(m.salaryShare), m.savingRate == null ? '' : m.minOk ? 'Ok' : 'No', num(m.balance),
    m.goalReached == null ? '' : m.goalReached ? 'Sì' : 'No', num(m.invested > 0.005 ? m.invested : 0),
  ]);
  const goal = yearGoals()[y];
  const csv = [head, ...rows, [], ['Obiettivo di saldo', num(goal)]].map((r) => r.join(';')).join('\n');
  download(`overview_${y}.csv`, '\uFEFF' + csv + '\n', 'text/csv');
});
$('#ov-goal').addEventListener('change', (e) => {
  const y = $('#ov-year').value;
  state.yearGoals = yearGoals();
  if (e.target.value === '') delete state.yearGoals[y];
  else state.yearGoals[y] = Number(e.target.value);
  persist();
  renderOverview();
});

$('#ov-min').addEventListener('change', (e) => {
  state.settings.minSaving = Math.max(0, Number(e.target.value) || 0) / 100;
  persist();
  renderOverview();
});
$('#ov-table').addEventListener('click', (e) => {
  const r = e.target.closest('tr[data-month]');
  if (!r) return;
  $('#f-period').value = $('#f-period').value === r.dataset.month ? '' : r.dataset.month;
  renderList();
  $('#list-title').scrollIntoView({ behavior: 'smooth' });
});

function renderList() {
  renderListFilters();
  renderOverview();
  const list = filteredList();
  const total = list.reduce((s, t) => s + (categoryType(t.category) === 'transfer' ? 0 : t.amount), 0);
  const p = $('#f-period').value;
  $('#list-title').textContent = p ? `Movimenti di ${p.length === 7 ? `${MONTH_NAMES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p}` : 'Tutti i movimenti';
  $('#list-count').textContent = `${list.length} movimenti · saldo (esclusi trasferimenti): ${eur(total)}`;
  $('#list-table').innerHTML = list.length
    ? `<thead><tr><th>Data</th><th>Beneficiario</th><th>Categoria</th><th style="text-align:right">Importo</th><th></th></tr></thead>
       <tbody>${list.slice(0, 1000).map((t) => txRow(t)).join('')}</tbody>`
    : '<tr><td class="empty">Nessun movimento</td></tr>';
}
['#f-search', '#f-period', '#f-account', '#f-category'].forEach((s) => $(s).addEventListener('input', renderList));

$('#list-table').addEventListener('change', (e) => {
  if (e.target.dataset.act !== 'cat') return;
  const t = state.transactions.find((x) => x.id === e.target.closest('tr').dataset.id);
  changeCategory(t, e.target.value, () => renderList());
});
$('#list-table').addEventListener('click', (e) => {
  if (e.target.dataset.act !== 'del') return;
  const id = e.target.closest('tr').dataset.id;
  const t = state.transactions.find((x) => x.id === id);
  if (!confirm(`Eliminare "${t.payee}" ${eur(t.amount)} del ${t.date}?`)) return;
  state.transactions = state.transactions.filter((x) => x.id !== id);
  linkTransfers(state);
  persist();
  renderList();
});

// Cambio categoria: chiede se creare una regola per tutti i movimenti simili
function changeCategory(t, value, done) {
  const [category, subcategory] = value.split('|');
  Object.assign(t, { category, subcategory, catSource: 'manuale' });
  const similar = state.transactions.filter((x) => x !== t && x.payee === t.payee && x.catSource !== 'manuale');
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog">
    <h2>Categoria aggiornata</h2>
    <p>Vuoi usare <b>${esc(category)} › ${esc(subcategory)}</b> per tutti i movimenti di <b>${esc(t.payee)}</b>?
      ${similar.length ? `(${similar.length} già presenti verranno aggiornati)` : ''}</p>
    <label>Testo da riconoscere<input name="match" value="${esc(t.payee)}"></label>
    <div class="toolbar"><button value="rule">Sì, crea regola</button><button value="once" class="secondary">Solo questo</button></div>
  </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue === 'rule') {
      const match = dlg.querySelector('[name=match]').value.trim();
      if (match) {
        state.rules = state.rules.filter((r) => r.match.toLowerCase() !== match.toLowerCase());
        state.rules.push({ match, category, subcategory });
        recategorize();
      }
    }
    linkTransfers(state);
    persist();
    done();
  };
  dlg.showModal();
}

function recategorize(list = state.transactions) {
  for (let i = 0; i < list.length; i++) Object.assign(list[i], applyCategory(list[i], state));
  linkTransfers(state);
}

$('#btn-dups').addEventListener('click', showDuplicates);

function showDuplicates() {
  const pairs = findSavedDuplicates(state);
  const dlg = $('#dlg');
  const side = (t) => `<div class="dup-side"><b>${esc(t.payee)}</b> <span class="${t.amount < 0 ? 'neg' : 'pos'}">${eur(t.amount)}</span>
    <div class="muted">${t.date.split('-').reverse().join('/')} · ${esc(t.account)} · ${esc(t.category)} › ${esc(t.subcategory)}</div>
    <div class="muted">${esc(t.note)}</div><div class="muted">da: ${esc(t.source || 'import precedente')}</div>
    <button class="link" data-del="${t.id}">Elimina questo</button></div>`;
  dlg.innerHTML = `<form method="dialog" class="dups">
    <h2>Possibili duplicati</h2>
    <p class="hint">Stesso conto e stesso importo, a massimo 3 giorni di distanza, da estratti diversi.
      Tieni quello con il beneficiario più preciso.</p>
    ${pairs.length ? pairs.map(([a, b]) => `<div class="dup-pair" data-pair="${a.id}|${b.id}">${side(a)}${side(b)}
      <button class="link" data-keep="${a.id}|${b.id}">Non sono doppioni</button></div>`).join('')
      : '<p class="empty">Nessun duplicato trovato 👍</p>'}
    <div class="toolbar"><button value="close">Chiudi</button></div>
  </form>`;
  dlg.onclick = (e) => {
    const del = e.target.dataset.del;
    const keep = e.target.dataset.keep;
    if (!del && !keep) return;
    e.preventDefault();
    if (del) state.transactions = state.transactions.filter((t) => t.id !== del);
    if (keep) state.notDuplicates = [...(state.notDuplicates || []), keep.split('|').sort().join('|')];
    linkTransfers(state);
    persist();
    showDuplicates();
  };
  dlg.onclose = () => { dlg.onclick = null; render(); };
  if (!dlg.open) dlg.showModal();
}

$('#btn-export').addEventListener('click', () => download(`spese_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filteredList()), 'text/csv'));

$('#btn-add').addEventListener('click', () => {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog">
    <h2>Aggiungi movimento</h2>
    <label>Data<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
    <label>Importo (negativo = spesa)<input name="amount" type="number" step="0.01" value="-" required></label>
    <label>Beneficiario<input name="payee" required></label>
    <label>Nota<input name="note"></label>
    <label>Conto<input name="account" value="Contanti" list="acc-list"><datalist id="acc-list">${accounts().map((a) => `<option value="${esc(a)}">`).join('')}</datalist></label>
    <label>Categoria<select name="cat"><option value="">Automatica</option>${categoryOptions('')}</select></label>
    <div class="toolbar"><button value="ok">Aggiungi</button><button value="cancel" class="secondary" formnovalidate>Annulla</button></div>
  </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const f = Object.fromEntries(new FormData(dlg.querySelector('form')));
    let t = { id: newId(), createdAt: Date.now(), date: f.date, amount: Number(f.amount), payee: f.payee, note: f.note, currency: 'EUR', account: f.account || 'Contanti' };
    if (Number.isNaN(t.amount)) return;
    if (f.cat) { const [category, subcategory] = f.cat.split('|'); t = { ...t, category, subcategory, catSource: 'manuale' }; }
    else t = applyCategory(t, state);
    state.transactions.push(t);
    state.transactions.sort((a, b) => b.date.localeCompare(a.date));
    persist();
    renderList();
  };
  dlg.showModal();
});

// ---------- IMPORTA ----------
const drop = $('#drop');
$('#file').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });

const pending = new Map(); // id import -> { file, lines, result, txs }

async function handleFiles(files) {
  for (const file of files) {
    const id = newId();
    const box = document.createElement('div');
    box.className = 'card';
    box.id = 'imp-' + id;
    box.innerHTML = `<h2>${esc(file.name)}</h2><p class="hint">Elaboro…</p>`;
    $('#import-results').prepend(box);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (/\.csv$/i.test(file.name)) {
        const txs = parseCsv(new TextDecoder().decode(buf));
        pending.set(id, { file, lines: null, result: { bank: 'csv', bankLabel: 'CSV', holder: null, transactions: txs } });
      } else {
        const lines = await extractLines(pdfjs, buf);
        pending.set(id, { file, lines, result: parseStatement(lines) });
      }
      prepareImport(id);
    } catch (err) {
      box.innerHTML = `<h2>${esc(file.name)}</h2><p class="neg">Errore: ${esc(err.message)}</p>`;
      console.error(err);
    }
  }
}

function prepareImport(id, bankOverride) {
  const imp = pending.get(id);
  if (bankOverride) imp.result = parseStatement(imp.lines, bankOverride);
  const { result } = imp;
  if (result.holder && !state.settings.ownNames.length) {
    state.settings.ownNames = [result.holder];
    persist();
  }
  const account = imp.account || (result.bank === 'csv' ? guessAccountFromName(imp.file.name) : result.bankLabel);
  imp.account = account;
  imp.txs = result.transactions.map((t) => {
    const withAcc = { ...t, account: t.account || account, source: imp.file.name };
    return t.category ? { ...withAcc, catSource: 'manuale' } : applyCategory(withAcc, state);
  });
  renderImport(id);
}

// Esito del controllo: i movimenti letti sommati al saldo iniziale danno il saldo finale del PDF?
function balanceCheck(b) {
  if (!b) return '';
  const when = b.date ? ` al ${b.date.split('-').reverse().join('/')}` : '';
  const detail = b.pending ? ` (contabile ${eur(b.booked)}, in sospeso ${eur(b.pending)})` : '';
  const check = b.warnings?.length
    ? `<br><span class="neg">⚠️ Controllo saldi non riuscito: ${b.warnings.map(esc).join("; ")}</span>`
    : '<br><span class="pos">✓ Movimenti coerenti con i saldi del PDF</span>';
  return `<p class="hint">Saldo${when}: <b>${eur(b.available)}</b>${detail}${check}</p>`;
}

function guessAccountFromName(name) {
  const p = PARSERS.find((x) => x.id !== 'generic' && name.toLowerCase().includes(x.id));
  return p ? p.label : 'Importato';
}

function renderImport(id) {
  const imp = pending.get(id);
  const box = $('#imp-' + id);
  const { result, txs } = imp;
  const out = -txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const inn = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const twins = matchExisting(state, txs);
  const dups = twins.filter(Boolean).length;
  const fresh = txs.length - dups;
  box.innerHTML = `<h2>${esc(imp.file.name)}</h2>
    <div class="toolbar">
      ${imp.lines ? `<label>Formato <select data-act="bank">${PARSERS.map((p) => `<option value="${p.id}"${p.id === result.bank ? ' selected' : ''}>${p.label}</option>`).join('')}</select></label>` : ''}
      <label>Conto <input data-act="account" value="${esc(imp.account)}" size="12"></label>
      <span class="muted">${txs.length} movimenti · uscite ${eur(out)} · entrate ${eur(inn)}${dups ? ` · <b>${dups} già presenti</b> (verranno saltati)` : ''}</span>
    </div>
    ${balanceCheck(result.balance)}
    ${txs.length ? `<div class="table-wrap"><table class="tx"><tbody>${txs.map((t, i) => txRow({ ...t, id: i }, { editable: false, twin: twins[i] })).join('')}</tbody></table></div>`
      : '<p class="neg">Nessun movimento riconosciuto. Prova a cambiare formato o guarda il testo estratto.</p>'}
    <div class="toolbar" style="margin-top:12px">
      <button data-act="save"${fresh || dups ? '' : ' disabled'}>${fresh ? `Salva ${fresh} nuovi movimenti` : 'Nessun movimento nuovo: conferma'}</button>
      <button data-act="csv" class="secondary"${txs.length ? '' : ' disabled'}>Scarica CSV</button>
      ${imp.lines ? '<button data-act="dump" class="secondary">Mostra testo estratto</button>' : ''}
      <button data-act="discard" class="link">Scarta</button>
    </div>
    <div data-slot="dump"></div>`;

  box.onchange = (e) => {
    const act = e.target.dataset.act;
    if (act === 'bank') prepareImport(id, e.target.value);
    else if (act === 'account') { imp.account = e.target.value.trim() || imp.account; imp.txs.forEach((t) => (t.account = imp.account)); }
    else if (act === 'cat') {
      const t = imp.txs[Number(e.target.closest('tr').dataset.id)];
      const [category, subcategory] = e.target.value.split('|');
      Object.assign(t, { category, subcategory, catSource: 'manuale' });
    }
  };
  box.onclick = (e) => {
    const act = e.target.dataset.act;
    if (act === 'save') {
      const { added, skipped, improved } = addTransactions(state, imp.txs);
      if (imp.result.iban) state.accounts[imp.account] = { ...state.accounts[imp.account], iban: imp.result.iban };
      const bal = imp.result.balance;
      const prev = state.balances[imp.account];
      if (bal && (!prev || !prev.date || (bal.date || '') >= prev.date)) {
        state.balances[imp.account] = { date: bal.date, booked: bal.booked, pending: bal.pending, available: bal.available };
      }
      linkTransfers(state);
      persist();
      pending.delete(id);
      box.innerHTML = `<h2>${esc(imp.file.name)}</h2><p>✅ ${added} movimenti salvati${skipped ? `, ${skipped} già presenti saltati` : ''}${improved ? ` (${improved} aggiornati con il beneficiario più preciso)` : ''}.
        <button class="link" data-go="summary">Vai al riepilogo</button></p>`;
    } else if (act === 'csv') {
      download(imp.file.name.replace(/\.(pdf|csv)$/i, '') + '.csv', toCsv(imp.txs), 'text/csv');
    } else if (act === 'dump') {
      box.querySelector('[data-slot=dump]').innerHTML = `<p class="hint">Testo estratto con le posizioni orizzontali [x]. Se il formato non viene riconosciuto bene,
        copia questo testo (puoi oscurare nomi e IBAN) per migliorare il parser.</p>
        <pre class="dump">${esc(imp.lines.map((l) => `p${l.page} ` + l.cells.map((c) => `[${Math.round(c.x)}] ${c.text}`).join(' | ')).join('\n'))}</pre>`;
    } else if (act === 'discard') {
      pending.delete(id);
      box.remove();
    }
  };
}

// ---------- CONTI ----------
// Diagramma degli spostamenti tra i conti (giroconti, ricariche, prelievi, salvadanai) e gestione dei conti.

function renderAccounts() {
  fillSelect($('#acc-period'), periodOptions());
  const period = $('#acc-period').value;
  const flows = accountFlows(state, (t) => inPeriod(t, period));
  const balances = Object.fromEntries(currentBalances());
  $('#acc-diagram').innerHTML = flows.length ? flowDiagram(flows, balances) : '<p class="empty">Nessuno spostamento tra conti nel periodo.</p>';
  $('#acc-flows').innerHTML = flows.length ? `<table class="tx"><thead><tr><th>Da</th><th></th><th>A</th><th style="text-align:right">Importo</th></tr></thead><tbody>${flows.map((f) =>
    `<tr><td>${esc(f.from)}</td><td>→</td><td>${esc(f.to)}<div class="muted">${f.count} moviment${f.count === 1 ? 'o' : 'i'}</div></td><td class="num">${eur(f.amount)}</td></tr>`).join('')}</tbody></table>` : '';
  const unknown = flows.filter((f) => /sconosciuto/.test(f.from + f.to)).reduce((s, f) => s + f.count, 0);
  $('#acc-unknown').innerHTML = unknown
    ? `${unknown} trasferimenti non hanno un conto di destinazione riconoscibile: aggiungi l'IBAN del conto qui sotto o importa anche l'estratto dell'altro conto.` : '';

  const names = [...new Set([...accounts(), ...Object.keys(state.accounts || {}), ...Object.keys(state.balances || {}), CASH])];
  $('#acc-table').innerHTML = `<thead><tr><th>Conto</th><th>IBAN</th><th style="text-align:right">Saldo</th><th></th></tr></thead><tbody>${names.map((n) => {
    const b = balances[n];
    return `<tr><td class="payee">${n === CASH ? '💵 ' : ''}${esc(n)}</td>
      <td>${n === CASH ? '<span class="muted">—</span>' : `<input data-iban="${esc(n)}" value="${esc(state.accounts?.[n]?.iban || '')}" placeholder="IT..." size="30">`}</td>
      <td class="num">${b ? eur(b.available) : '<span class="muted">—</span>'}</td>
      <td><button class="link" data-setbal="${esc(n)}">${b ? 'Aggiorna saldo' : 'Imposta saldo'}</button></td></tr>`;
  }).join('')}</tbody>`;
}

$('#acc-period').addEventListener('change', renderAccounts);
$('#acc-table').addEventListener('change', (e) => {
  const acc = e.target.dataset.iban;
  if (acc == null) return;
  state.accounts[acc] = { ...state.accounts[acc], iban: e.target.value.replace(/\s/g, '').toUpperCase() || undefined };
  linkTransfers(state);
  persist();
  renderAccounts();
});
$('#acc-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#acc-name').value.trim();
  if (!name) return;
  state.accounts[name] = { ...state.accounts[name], iban: $('#acc-iban').value.replace(/\s/g, '').toUpperCase() || undefined };
  $('#acc-name').value = '';
  $('#acc-iban').value = '';
  persist();
  renderAccounts();
});

// Diagramma ad archi: i conti principali su una riga, le "tasche" di un conto (salvadanaio, investimenti,
// altre valute) sotto il conto a cui appartengono. Gli spostamenti verso destra passano sopra la riga,
// quelli verso sinistra sotto, così andata e ritorno non si sovrappongono.
function flowDiagram(flows, balances) {
  const all = [...new Set(flows.flatMap((f) => [f.from, f.to]))];
  const parentOf = (n) => (n.includes(' · ') ? n.split(' · ')[0] : null);
  const volume = (n) => flows.filter((f) => f.from === n || f.to === n).reduce((s, f) => s + f.amount, 0);
  const mains = [...new Set(all.map((n) => parentOf(n) || n))].sort((a, b) => volume(b) - volume(a));
  // il conto con più movimento al centro, gli altri alternati a destra e sinistra
  const order = [];
  mains.forEach((n, i) => (i % 2 ? order.unshift(n) : order.push(n)));
  const subsOf = (m) => all.filter((n) => parentOf(n) === m);

  const SUB_W = 150;
  const widths = order.map((m) => Math.max(170, subsOf(m).length * SUB_W));
  const W = Math.max(560, widths.reduce((a, b) => a + b, 0) + 40);
  const maxSpan = W - 40;
  const topRoom = 40 + Math.min(150, maxSpan * 0.22);
  const ROW_Y = topRoom + 30;
  const SUB_Y = ROW_Y + 210;
  const H = SUB_Y + 60;
  const pos = {};
  let x = 20;
  order.forEach((m, i) => {
    pos[m] = { x: x + widths[i] / 2, y: ROW_Y };
    const subs = subsOf(m);
    subs.forEach((n, j) => { pos[n] = { x: x + widths[i] / 2 + (j - (subs.length - 1) / 2) * SUB_W, y: SUB_Y }; });
    x += widths[i];
  });

  const max = Math.max(...flows.map((f) => f.amount));
  const label = (v) => eur(v).replace(/,\d\d\s/, ' ');
  const edges = flows.map((f) => {
    const a = pos[f.from];
    const b = pos[f.to];
    const w = 1.5 + (f.amount / max) * 9;
    let d;
    let lx;
    let ly;
    if (a.y === b.y) {
      // tra conti principali: arco sopra (verso destra) o sotto (verso sinistra)
      const dir = b.x > a.x ? -1 : 1;
      const h = Math.min(150, Math.abs(b.x - a.x) * 0.22) * dir;
      const sx = a.x + (b.x > a.x ? 30 : -30);
      const ex = b.x + (b.x > a.x ? -30 : 30);
      const sy = a.y + dir * 22;
      const ey = b.y + dir * 22;
      d = `M${sx},${sy} C${sx},${sy + h} ${ex},${ey + h} ${ex},${ey}`;
      lx = (sx + ex) / 2;
      ly = sy + h * 0.75 + (dir < 0 ? -4 : 14);
    } else {
      // verso/da una "tasca" sotto il conto: due linee affiancate (giù a sinistra, su a destra)
      const down = b.y > a.y;
      const off = down ? -10 : 10;
      const sx = a.x + off;
      const ex = b.x + off;
      const sy = a.y + (down ? 26 : -20);
      const ey = b.y + (down ? -20 : 26);
      d = `M${sx},${sy} C${sx},${(sy + ey) / 2} ${ex},${(sy + ey) / 2} ${ex},${ey}`;
      // etichetta vicino alla tasca, dove le linee sono già separate
      const t = 0.72;
      lx = (down ? sx : ex) + (ex - sx) * (down ? t : 1 - t) + (down ? -8 : 8);
      ly = sy + (ey - sy) * (down ? t : 1 - t);
      return `<g class="flow"><title>${esc(f.from)} → ${esc(f.to)}: ${eur(f.amount)} (${f.count} movimenti)</title>
        <path d="${d}" stroke-width="${w.toFixed(1)}" marker-end="url(#arrow)"/>
        <text x="${lx}" y="${ly}" text-anchor="${down ? 'end' : 'start'}">${label(f.amount)}</text></g>`;
    }
    return `<g class="flow"><title>${esc(f.from)} → ${esc(f.to)}: ${eur(f.amount)} (${f.count} movimenti)</title>
      <path d="${d}" stroke-width="${w.toFixed(1)}" marker-end="url(#arrow)"/>
      <text x="${lx}" y="${ly}" text-anchor="middle">${label(f.amount)}</text></g>`;
  }).join('');

  const nodeEls = all.map((n) => {
    const p = pos[n];
    const sub = parentOf(n);
    const name = sub ? n.split(' · ')[1] : n;
    const bal = balances[n];
    const wBox = Math.max(sub ? 110 : 120, name.length * 8 + 24);
    const h = bal ? 46 : 32;
    return `<g class="node${bal ? '' : ' ext'}"><rect x="${p.x - wBox / 2}" y="${p.y - h / 2}" width="${wBox}" height="${h}" rx="10"/>
      <text x="${p.x}" y="${p.y + (bal ? -3 : 5)}" text-anchor="middle" class="nm">${esc(name)}</text>
      ${bal ? `<text x="${p.x}" y="${p.y + 15}" text-anchor="middle" class="bl">${eur(bal.available)}</text>` : ''}</g>`;
  }).join('');
  return `<div class="flows-wrap"><svg viewBox="0 0 ${W} ${H}" class="flows" style="min-width:${Math.min(W, 900)}px" role="img" aria-label="Spostamenti di denaro tra i tuoi conti">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>${edges}${nodeEls}</svg></div>`;
}

// ---------- REGOLE ----------
function renderRules() {
  $('#rule-cat').innerHTML = categoryOptions('');
  $('#rules-table').innerHTML = state.rules.length
    ? `<thead><tr><th>Se contiene</th><th>Categoria</th><th></th></tr></thead><tbody>${state.rules.map((r, i) =>
        `<tr><td>${esc(r.match)}${r.amount ? ` <span class="tag">solo ${eur(r.amount)}</span>` : ''}</td><td>${esc(r.category)} › ${esc(r.subcategory)}</td><td><button class="link" data-del="${i}">✕</button></td></tr>`).join('')}</tbody>`
    : '<tr><td class="empty">Nessuna regola personale per ora</td></tr>';
  $('#cat-list').innerHTML = CATEGORIES.map((c) => `<div><b>${c.icon} ${esc(c.name)}</b>${c.subs.map(esc).join(', ')}</div>`).join('');
}
$('#rule-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const [category, subcategory] = $('#rule-cat').value.split('|');
  const amount = $('#rule-amount').value ? Math.abs(Number($('#rule-amount').value)) : undefined;
  state.rules.push({ match: $('#rule-match').value.trim(), category, subcategory, ...(amount ? { amount } : {}) });
  $('#rule-match').value = '';
  $('#rule-amount').value = '';
  recategorize();
  persist();
  renderRules();
});
$('#rules-table').addEventListener('click', (e) => {
  if (e.target.dataset.del == null) return;
  state.rules.splice(Number(e.target.dataset.del), 1);
  recategorize();
  persist();
  renderRules();
});

// ---------- IMPOSTAZIONI ----------
function renderSettings() {
  $('#own-names').value = state.settings.ownNames.join('\n');
}
$('#save-names').addEventListener('click', () => {
  state.settings.ownNames = $('#own-names').value.split('\n').map((s) => s.trim()).filter(Boolean);
  recategorize();
  persist();
  alert('Salvato');
});
$('#recat-all').addEventListener('click', () => {
  if (!confirm('Ricalcolare le categorie automatiche? Le categorie che hai scelto a mano restano invariate.')) return;
  recategorize();
  persist();
  alert('Fatto');
});
$('#backup-export').addEventListener('click', () => download(`spese_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1), 'application/json'));
$('#backup-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.transactions)) throw new Error('file non valido');
    if (!confirm(`Sostituire i dati attuali con il backup (${data.transactions.length} movimenti)?`)) return;
    state = { ...load(), ...data };
    persist();
    render();
  } catch (err) {
    alert('Backup non valido: ' + err.message);
  }
  e.target.value = '';
});
$('#wipe').addEventListener('click', () => {
  if (!confirm('Cancellare TUTTI i movimenti, le regole e le impostazioni da questo browser?')) return;
  localStorage.removeItem('spese.v1');
  state = load();
  render();
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- render ----------
function render() {
  const active = document.querySelector('.tab.active')?.id;
  if (active === 'tab-summary') renderSummary();
  if (active === 'tab-list') renderList();
  if (active === 'tab-rules') renderRules();
  if (active === 'tab-settings') renderSettings();
  if (active === 'tab-accounts') renderAccounts();
}
render();

$('#version').textContent = `v${VERSION}`;
fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).then(({ version }) => {
  if (version && version !== VERSION) {
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = `C'è una versione nuova dell'app (${esc(version)}). <button class="link">Ricarica</button>`;
    bar.querySelector('button').onclick = () => location.reload();
    document.body.prepend(bar);
  }
}).catch(() => {});
