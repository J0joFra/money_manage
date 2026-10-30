import * as pdfjs from '../vendor/pdf.min.mjs';
import { extractLines } from './pdf-text.js';
import { parseStatement, PARSERS } from './parsers/index.js';
import { parseCsv, toCsv } from './csv.js';
import { CATEGORIES, categoryType } from './categories.js';
import { load, save, addTransactions, applyCategory, linkTransfers, matchExisting, findSavedDuplicates, newId } from './store.js';

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
  return Object.entries(state.balances || {}).map(([acc, b]) => {
    const later = state.transactions.filter((t) => t.account === acc && b.date && t.date > b.date);
    const delta = later.reduce((s, t) => s + t.amount, 0);
    const last = later.reduce((d, t) => (t.date > d ? t.date : d), b.date || '');
    return [acc, { ...b, available: b.available + delta, date: last, rolled: later.length, from: b.date }];
  });
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
      ${b.rolled ? `<div class="muted">saldo estratto al ${b.from.slice(8)}/${b.from.slice(5, 7)} + ${b.rolled} movimenti successivi</div>` : ''}</div>`).join('')}
    <div class="tile"><div class="k">Totale conti</div><div class="v">${eur(total)}</div></div></div>`;
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

  // contanti: prelievi (fino alla fine del periodo) + movimenti registrati sul conto "Contanti"
  const end = period ? period + '\uffff' : '\uffff';
  const upTo = state.transactions.filter((t) => t.date <= end);
  const withdrawn = -upTo.filter((t) => t.subcategory === 'Prelievo contanti').reduce((s, t) => s + t.amount, 0);
  const cashMoves = upTo.filter((t) => /^contanti$/i.test(t.account || '')).reduce((s, t) => s + t.amount, 0);
  $('#sum-transfers').innerHTML = (rows ? `<table class="tx">${rows}</table>` : '<p class="hint">Nessun trasferimento nel periodo.</p>') +
    `<h2 class="mt">💵 Contanti in tasca (stima)</h2>
     <p class="v ${withdrawn + cashMoves < 0 ? 'neg' : ''}" style="font-size:22px;font-weight:700;margin:0">${eur(withdrawn + cashMoves)}</p>
     <p class="hint">Prelievi ${eur(withdrawn)} − spese in contanti ${eur(-cashMoves)}.
       Registra le spese in contanti con <button class="link" data-go="list">+ Aggiungi a mano</button> (conto "Contanti").</p>`;
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

function renderList() {
  renderListFilters();
  const list = filteredList();
  const total = list.reduce((s, t) => s + (categoryType(t.category) === 'transfer' ? 0 : t.amount), 0);
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
    let t = { id: newId(), date: f.date, amount: Number(f.amount), payee: f.payee, note: f.note, currency: 'EUR', account: f.account || 'Contanti' };
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
}
render();
