// Test dei parser: per ogni tests/fixtures/<banca>.pdf con <banca>.expected.csv accanto,
// confronta Amount/Date/Payee/Currency estratti con quelli attesi.
// Le fixture contengono dati personali e NON vengono committate (vedi .gitignore).
// Uso: node tests/run.mjs [--dump file.pdf]

import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLines } from '../src/pdf-text.js';
import { parseStatement } from '../src/parsers/index.js';
import { parseCsv } from '../src/csv.js';
import { categorize } from '../src/categories.js';

const here = path.dirname(new URL(import.meta.url).pathname);
// fixtures/: estratti conto reali (non committati). synthetic/: PDF inventati che imitano i layout.
const dirs = [path.join(here, 'fixtures'), path.join(here, 'synthetic')].filter((d) => fs.existsSync(d));

async function load(file) {
  return extractLines(pdfjs, new Uint8Array(fs.readFileSync(file)));
}

if (process.argv[2] === '--dump') {
  const lines = await load(process.argv[3]);
  for (const l of lines) console.log(`p${l.page} ${l.cells.map((c) => `[${Math.round(c.x)}-${Math.round(c.end)}] ${c.text}`).join(' | ')}`);
  const res = parseStatement(lines);
  console.log(JSON.stringify(res, null, 1));
  process.exit(0);
}

let failed = 0;
let ran = 0;
for (const [dir, f] of dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.pdf')).map((f) => [d, f]))) {
  const expectedFile = path.join(dir, f.replace(/\.pdf$/, '.expected.csv'));
  if (!fs.existsSync(expectedFile)) continue;
  ran++;
  const res = parseStatement(await load(path.join(dir, f)));
  const expected = parseCsv(fs.readFileSync(expectedFile, 'utf8'));
  const key = (t) => `${t.date}|${t.amount.toFixed(2)}|${t.payee.toLowerCase()}|${t.currency}`;
  const got = res.transactions.map(key);
  const exp = expected.map(key);
  const missing = exp.filter((k) => { const i = got.indexOf(k); if (i >= 0) { got.splice(i, 1); return false; } return true; });
  const ok = !missing.length && !got.length;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path.basename(dir)}/${f} [${res.bank}] ${res.transactions.length} movimenti (attesi ${expected.length})`);
  for (const m of missing) console.log('   mancante:', m);
  for (const g of got) console.log('   in più:  ', g);
  if (process.argv.includes('-v')) {
    for (const t of res.transactions) {
      const c = categorize(t, { ownNames: [res.holder].filter(Boolean) });
      console.log(`   ${t.date} ${t.amount.toFixed(2).padStart(9)} ${t.payee.padEnd(28)} → ${c.category} / ${c.subcategory}`);
    }
  }
}

// test unitari di base
import { parseAmount, parseDate } from '../src/parsers/common.js';
const unit = [
  [parseAmount('1.259,42€').value, 1259.42],
  [parseAmount('-12,50 €').value, -12.5],
  [parseAmount('+100,00€').value, 100],
  [parseAmount('€ 3,00').value, 3],
  [parseAmount('1,234.56').value, 1234.56],
  [parseAmount('12,00-').value, -12],
  [parseAmount('ID 123'), null],
  [parseDate('3 ott 2026'), '2026-10-03'],
  [parseDate('03.10.2026'), '2026-10-03'],
  [parseDate('03/10/26'), '2026-10-03'],
  [parseDate('2026-10-03'), '2026-10-03'],
  [parseDate('12 settembre 2026'), '2026-09-12'],
];
// abbinamento giroconti tra conti diversi
import { linkTransfers, applyCategory } from '../src/store.js';
{
  const st = { rules: [], settings: { ownNames: [] }, transactions: [] };
  const mk = (id, account, date, amount, payee, note = '') => applyCategory({ id, account, date, amount, payee, note, currency: 'EUR' }, st);
  st.transactions = [
    mk('a', 'BBVA', '2026-09-21', -1000, 'Bonifico', 'Bonifico · XYZ'),
    mk('b', 'Revolut', '2026-09-23', 1000, 'Bonifico in entrata', 'XYZ'),
    mk('c', 'Revolut', '2026-09-23', -20, 'Bar Sport', ''),
    mk('d', 'N26', '2026-09-30', 20, 'LUCA VERDI', 'Riferimento: pizza'),
    mk('e', 'BBVA', '2026-09-01', -300, 'Bonifico', 'Bonifico · ABC'),
    mk('f', 'Revolut', '2026-09-15', 300, 'Bonifico', 'ABC'),
  ];
  linkTransfers(st);
  const by = Object.fromEntries(st.transactions.map((t) => [t.id, t]));
  unit.push([by.a.linkedId, 'b'], [by.b.category, 'Trasferimenti'], [by.c.linkedId, undefined], [by.e.linkedId, undefined]);
  by.b.catSource = 'manuale';
  linkTransfers(st);
  unit.push([by.a.linkedId, undefined], [by.a.category, 'Da categorizzare']);
}
// regole con importo
{
  const c = (amount, payee, userRules) => categorize({ amount, payee, note: 'Ordine di pagamento · 123' }, { userRules }).subcategory;
  unit.push([c(-50, 'Ordine di pagamento'), 'Investimenti e risparmi'], [c(-600, 'Ordine di pagamento'), 'Giroconto tra miei conti'],
    [c(-70, 'Ordine di pagamento'), 'Altro'],
    [c(-80, 'Affitto', [{ match: 'affitto', category: 'Casa', subcategory: 'Affitto', amount: 80 }]), 'Affitto'],
    [c(-81, 'Affitto', [{ match: 'affitto', category: 'Casa', subcategory: 'Affitto', amount: 80 }]), 'Altro']);
}
unit.forEach(([a, b], i) => { if (a !== b) { failed++; console.log(`FAIL unit #${i}: ${a} !== ${b}`); } });
console.log(`${unit.length} test unitari, ${ran} fixture PDF`);
process.exit(failed ? 1 : 0);
