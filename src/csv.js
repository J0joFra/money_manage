// Lettura/scrittura CSV nel formato: Amount,Date,Note,Payee,Currency[,Category,Subcategory,Account]

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function parseCsv(text) {
  const [header, ...rows] = parseCsvRows(text);
  const idx = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const col = { amount: idx('amount'), date: idx('date'), note: idx('note'), payee: idx('payee'), currency: idx('currency'), category: idx('category'), subcategory: idx('subcategory'), account: idx('account') };
  if (col.amount < 0 || col.date < 0) throw new Error('Il CSV deve avere almeno le colonne Amount e Date');
  return rows.map((r) => ({
    amount: Number(String(r[col.amount]).replace(',', '.')),
    date: r[col.date].trim(),
    note: col.note >= 0 ? r[col.note] || '' : '',
    payee: col.payee >= 0 ? r[col.payee] || '' : '',
    currency: (col.currency >= 0 && r[col.currency]) || 'EUR',
    ...(col.category >= 0 && r[col.category] ? { category: r[col.category], subcategory: r[col.subcategory] || '' } : {}),
    ...(col.account >= 0 && r[col.account] ? { account: r[col.account] } : {}),
  })).filter((t) => !Number.isNaN(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
}

const q = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(txs, { extended = true } = {}) {
  const head = ['Amount', 'Date', 'Note', 'Payee', 'Currency', ...(extended ? ['Category', 'Subcategory', 'Account'] : [])];
  const lines = txs.map((t) => [
    t.amount, t.date, t.note, t.payee, t.currency,
    ...(extended ? [t.category, t.subcategory, t.account] : []),
  ].map(q).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
