// Parser per i PDF di BBVA (Italia). Due formati:
//  1. "Ultimi movimenti" (esportazione dall'app, max 6 mesi): vedi parseUltimiMovimenti più sotto
//  2. "Estratto conto trimestrale", descritto qui:
// Layout: "Data contabile | Data valuta | Causale | Importo (EUR) | Saldo (EUR)" con date senza anno (dd/mm)
// e importi firmati. La causale di ogni movimento è su più righe CENTRATE verticalmente sulla
// riga con data e importo: alcune righe stanno sopra, altre sotto. Per assegnarle al movimento giusto
// si sfrutta la simmetria: il blocco si estende sotto la riga della data quanto si estende sopra.

import { parseDate, parseAmount, cleanSpaces, round2, findIban } from './common.js';
import { parseGeneric } from './generic.js';

export const id = 'bbva';
export const label = 'BBVA';

export function detect(lines) {
  return lines.some((l) => /BBVAITMM|BANCO BILBAO|Linea BBVA/i.test(l.text)) ||
    lines.slice(0, 60).some((l) => /^BBVA\b/.test(l.text));
}

const SHORT_DATE = /^\d{2}\/\d{2}$/;
const TOLERANCE = 4; // pt

// tipo di operazione (prima riga della causale) -> etichetta leggibile
const TYPES = [
  [/^BONIFICI\b/, 'Bonifico'],
  [/^ORDINI DI PAGAMENTO EMESSI IN VALUTA LOCALE\b/, 'Ordine di pagamento'],
  [/^LIQUIDAZIONE INTERESSI-COMMISSIONI-SPESE\b/, 'Liquidazione interessi e spese'],
  [/^ADDEBITO A TUO CARICO\b/, 'Addebito diretto'],
  [/^TRASFERIMENTO\b/, 'Trasferimento'],
  [/^PAGAMENTO (CON )?CARTA\b|^PAGAMENTI CARTA\b/, 'Pagamento carta'],
  [/^PRELIEVO\b/, 'Prelievo'],
];

function periodYears(lines) {
  const l = lines.find((x) => /Periodo di riferimento/i.test(x.text));
  const m = l && l.text.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { startMonth: Number(m[2]), startYear: Number(m[3]) } : null;
}

export function parse(lines) {
  if (lines.some((l) => /^Ultimi movimenti/i.test(l.text))) return parseUltimiMovimenti(lines);
  const holderLine = lines.find((l) => /^Titolare/i.test(l.cells[0].text));
  const holder = holderLine?.cells[1]?.text.split(/[,;]/)[0].trim() || null;
  const period = periodYears(lines);
  const dateRows = lines.filter((l) => SHORT_DATE.test(l.cells[0].text) && l.cells.some((c) => parseAmount(c.text)));

  if (!period || !dateRows.length) {
    // altro layout BBVA (date complete su una riga): parser generico
    return { holder, transactions: parseGeneric(lines, { noise: /^(data valuta|valuta|pagina|page|iban|bic)\b|BBVA|Estratto conto/i }) };
  }

  const yearOf = (mm) => (mm < period.startMonth ? period.startYear + 1 : period.startYear);
  const toIso = (ddmm) => {
    const [d, m] = ddmm.split('/').map(Number);
    return parseDate(`${d}/${m}/${yearOf(m)}`);
  };

  // x dove inizia la causale: prima cella di testo sulle righe con la data
  const inlineXs = dateRows.flatMap((r) => r.cells.filter((c) => c.x > r.cells[1].end && !parseAmount(c.text)).map((c) => c.x));
  const descX = inlineXs.length ? Math.min(...inlineXs) : 230;
  const isDescLine = (l) => !SHORT_DATE.test(l.cells[0].text) && Math.abs(l.cells[0].x - descX) < 10 && !l.cells.some((c) => parseAmount(c.text));

  const txs = [];
  for (let page = 1; page <= Math.max(...lines.map((l) => l.page)); page++) {
    const pageLines = lines.filter((l) => l.page === page);
    const pageDates = pageLines.filter((l) => dateRows.includes(l));
    if (!pageDates.length) continue;
    const headerY = pageLines.find((l) => /Causale/i.test(l.text))?.y ?? Infinity;
    const desc = pageLines.filter((l) => l.y < headerY && isDescLine(l)).sort((a, b) => b.y - a.y);

    let i = 0;
    for (const row of pageDates) {
      const block = [];
      // righe sopra la data (fino alla riga della data inclusa)
      let top = row.y;
      while (i < desc.length && desc[i].y > row.y + 0.5) {
        top = Math.max(top, desc[i].y);
        block.push(desc[i++]);
      }
      const inline = row.cells.filter((c) => Math.abs(c.x - descX) < 10 && !parseAmount(c.text));
      // righe sotto: fino a una distanza pari a quella sopra
      const bottom = 2 * row.y - top - TOLERANCE;
      const next = pageDates[pageDates.indexOf(row) + 1];
      const below = [];
      while (i < desc.length && desc[i].y >= bottom && (!next || desc[i].y > next.y)) below.push(desc[i++]);
      const texts = [...block.map((l) => l.text), ...inline.map((c) => c.text), ...below.map((l) => l.text)];
      const amountCell = row.cells.find((c) => c.x > descX && parseAmount(c.text));
      txs.push(build(toIso(row.cells[0].text), parseAmount(amountCell.text).value, texts));
    }
  }
  const endLine = lines.find((l) => /Saldo fine trimestre/i.test(l.text));
  const startLine = lines.find((l) => /Saldo inizio trimestre/i.test(l.text));
  const amountIn = (l) => { const m = l?.text.match(/:\s*(-?[\d.]+,\d{2})/); return m ? parseAmount(m[1]).value : null; };
  const closing = amountIn(endLine);
  const opening = amountIn(startLine);
  const periodEnd = lines.find((x) => /Periodo di riferimento/i.test(x.text))?.text.match(/fino a (\d{2}\/\d{2}\/\d{4})/);
  let balance = null;
  if (closing != null) {
    const warnings = [];
    const sum = round2(txs.reduce((s, t) => s + t.amount, 0));
    if (opening != null && Math.abs(round2(opening + sum) - closing) > 0.005) {
      warnings.push(`saldo iniziale ${opening.toFixed(2)} + movimenti ${sum.toFixed(2)} ≠ saldo finale ${closing.toFixed(2)}`);
    }
    balance = { date: periodEnd ? parseDate(periodEnd[1]) : txs[txs.length - 1]?.date, booked: closing, pending: 0, available: closing, warnings };
  }
  const iban = findIban(lines.find((l) => /^IBAN/i.test(l.cells[0].text))?.text);
  return { holder, iban, transactions: txs, balance };
}

function build(date, amount, texts) {
  // unisci le righe: "INTERESSI-" + "COMMISSIONI-SPESE" senza spazio
  const full = cleanSpaces(texts.reduce((acc, t) => (acc.endsWith('-') ? acc + t : acc ? `${acc} ${t}` : t), ''));
  const type = TYPES.find(([re]) => re.test(full));
  let rest = type ? cleanSpaces(full.replace(type[0], '')) : full;
  rest = rest
    .replace(/^N \d{8,}\s*/, '') // numero mandato SDD
    .replace(/\bS\.P\. A\./, 'S.P.A.');
  // codici/riferimenti senza un nome (es. "TRASF", "2796575564 26503710854589") non sono un beneficiario
  const meaningful = rest && !/^[\d\s]+$/.test(rest) && !/^[a-z]{2,6}\d*$/i.test(rest) && !/^[A-Z]{3,}\d{3,}$/.test(rest);
  let payee = meaningful && type?.[1] !== 'Liquidazione interessi e spese' ? rest : type ? type[1] : rest;
  payee = payee
    .replace(/\s+(Viale|Via|V\.le|Piazza|P\.za|Corso|C\.so)\b.*$/i, '') // indirizzo del creditore
    .replace(/^ACCREDITO COMPETENZE.*$/i, 'Accredito competenze')
    .replace(/^.*\bSALVADANAIO\b.*$/i, 'Salvadanaio');
  return {
    date,
    amount: round2(amount),
    currency: 'EUR',
    payee,
    note: type ? `${type[1]}${rest ? ' · ' + rest : ''}` : full,
  };
}

// ---------------------------------------------------------------------------
// Formato "Ultimi movimenti": colonne Data | Causale | Beneficiario | Importo.
// Ogni movimento occupa 3 righe:
//   28/10/2026  | Bonifico eseguito      | IT54V0366901600906004683385 | -600,00 €
//   Data valuta | 2914412892 2650384...   | REVOLUT JO
//   28/10/2026  [| altra riga di causale]
// Per i pagamenti con carta la prima riga della causale è l'esercente e la seconda "Pagamento con carta".
// Non c'è il saldo, quindi niente controllo di coerenza.

const FULL_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const PAGE_NOISE = /^(Ultimi movimenti|Data$|BANCO BILBAO|Milano, Monza|\d+\/\d+$)/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

function parseUltimiMovimenti(lines) {
  const header = lines.find((l) => l.cells.some((c) => c.text === 'Causale') && l.cells.some((c) => c.text === 'Beneficiario'));
  const col = (name) => header.cells.find((c) => c.text === name)?.x;
  const causaleX = col('Causale');
  const benefX = col('Beneficiario');
  const importoX = col('Importo');
  const inCol = (c, x, next) => c.x >= x - 5 && (next == null || c.x < next - 5);

  const txs = [];
  let cur = null;
  const flush = () => { if (cur) txs.push(buildMovimento(cur)); cur = null; };

  for (const l of lines) {
    if (PAGE_NOISE.test(l.cells[0].text) || l === header || (l.cells[0].text === 'Data' && l.cells.length > 2)) continue;
    const first = l.cells[0];
    const amountCell = l.cells.find((c) => c.x >= importoX - 20 && parseAmount(c.text));
    if (FULL_DATE.test(first.text) && amountCell) {
      flush();
      cur = { date: parseDate(first.text), amount: parseAmount(amountCell.text).value, causale: [], benef: [] };
    } else if (!cur) {
      continue;
    }
    for (const c of l.cells) {
      if (c === first && (FULL_DATE.test(c.text) || c.text === 'Data valuta')) continue;
      if (c === amountCell) continue;
      if (inCol(c, causaleX, benefX)) cur.causale.push(c.text);
      else if (inCol(c, benefX, importoX - 20) && c.text !== '-') cur.benef.push(c.text);
    }
  }
  flush();
  // l'IBAN del conto è il beneficiario dei bonifici ricevuti
  const iban = txs.find((t) => t.ownIban)?.ownIban || null;
  for (const t of txs) delete t.ownIban;
  return { holder: null, iban, transactions: txs };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'.-])\p{L}/gu, (m) => m.toUpperCase());

function buildMovimento(m) {
  const causale = m.causale.reduce((acc, t) => (acc.endsWith('-') ? acc + t : acc ? `${acc} ${t}` : t), '');
  const iban = m.benef.find((b) => IBAN_RE.test(b));
  const name = cleanSpaces(m.benef.filter((b) => b !== iban).join(' '));
  const [kind, ...restParts] = m.causale;
  const rest = cleanSpaces(restParts.join(' '));
  let payee;
  let type;
  if (/^Bonifico eseguito/i.test(kind)) { type = 'Bonifico eseguito'; payee = name || rest; }
  else if (/^Bonifico ricevuto/i.test(kind)) { type = 'Bonifico ricevuto'; payee = rest.replace(/^Da\s+/i, '') || name; payee = /[a-z]/.test(payee) && payee === payee.toLowerCase() ? titleCase(payee) : payee; }
  else if (/^Addebito a tuo carico/i.test(kind)) { type = 'Addebito diretto'; payee = rest.replace(/^N \d{8,}\s*/, '').replace(/\s+(Viale|Via|V\.le|Piazza|Corso)\b.*$/i, ''); }
  else if (/^Liquidazione interessi/i.test(kind)) { type = 'Liquidazione interessi e spese'; payee = type; }
  else if (/^Trasferimento/i.test(kind)) { type = 'Trasferimento'; payee = /salvadanaio/i.test(causale) ? 'Salvadanaio' : rest || name || 'Trasferimento'; }
  else if (/^Pagamento con carta/i.test(rest)) { type = 'Pagamento con carta'; payee = titleCase(kind); }
  else { type = kind; payee = rest || name || kind; }
  const useless = (x) => !x || x === payee || x === type || /^commissioni-spese$/i.test(x);
  const extra = [useless(rest) ? '' : rest, useless(name) ? '' : name, iban || ''].filter(Boolean);
  // nei bonifici ricevuti l'IBAN in colonna "Beneficiario" è il tuo, negli altri è quello della controparte
  const received = type === 'Bonifico ricevuto';
  return {
    date: m.date,
    amount: round2(m.amount),
    currency: 'EUR',
    payee: cleanSpaces(payee) || type,
    note: [type, ...extra].join(' · '),
    counterIban: !received && iban ? iban : undefined,
    ownIban: received && iban ? iban : undefined,
  };
}
